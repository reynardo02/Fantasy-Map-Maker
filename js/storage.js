/* Speichern & Laden: Serialisierung, IndexedDB ("Meine Karten"), Dateien (.fmap) */
(function () {
  'use strict';
  const FMM = window.FMM;

  // ---------- Base64 für typisierte Arrays ----------
  function bytesToB64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Karte → reines JSON-Objekt (Höhen als Int16, Feuchte als Uint8)
  FMM.serializeMap = function (map) {
    const N = map.width * map.height;
    const hq = new Int16Array(N);
    for (let i = 0; i < N; i++) hq[i] = Math.round(FMM.clamp(map.heights[i], -1, 1) * 32767);
    const mq = new Uint8Array(N);
    for (let i = 0; i < N; i++) mq[i] = Math.round(FMM.clamp(map.moisture[i], 0, 1) * 255);
    return {
      format: 'fantasy-map-maker',
      version: 1,
      id: map.id,
      name: map.name,
      created: map.created,
      updated: Date.now(),
      width: map.width,
      height: map.height,
      settings: map.settings,
      view: map.view,
      states: map.states,
      cities: map.cities,
      labels: map.labels,
      heights: bytesToB64(new Uint8Array(hq.buffer)),
      moisture: bytesToB64(mq),
      stateMap: bytesToB64(new Uint8Array(map.stateMap.buffer, map.stateMap.byteOffset, map.stateMap.byteLength)),
      biomeMap: bytesToB64(map.biomeMap),
    };
  };

  FMM.deserializeMap = function (o) {
    if (!o || o.format !== 'fantasy-map-maker') throw new Error('Keine gültige Fantasy-Map-Maker-Datei.');
    const N = o.width * o.height;
    const hb = b64ToBytes(o.heights);
    const hq = new Int16Array(hb.buffer, hb.byteOffset, N);
    const heights = new Float32Array(N);
    for (let i = 0; i < N; i++) heights[i] = hq[i] / 32767;
    const mb = b64ToBytes(o.moisture);
    const moisture = new Float32Array(N);
    for (let i = 0; i < N; i++) moisture[i] = mb[i] / 255;
    const sb = b64ToBytes(o.stateMap);
    const stateMap = new Uint16Array(N);
    stateMap.set(new Uint16Array(sb.buffer, sb.byteOffset, N));
    // gemalte Landschaftsformen (255 = automatisch); ältere Dateien haben keine
    const biomeMap = new Uint8Array(N).fill(255);
    if (o.biomeMap) biomeMap.set(b64ToBytes(o.biomeMap).subarray(0, N));
    const view = Object.assign({ style: 'geo', relief: 1 }, o.view);
    view.layers = Object.assign({}, FMM.STYLE_PRESETS[view.style] || FMM.STYLE_PRESETS.geo, (o.view || {}).layers);
    const map = {
      version: 1,
      id: o.id || FMM.uid(),
      name: o.name || 'Unbenannte Karte',
      created: o.created || Date.now(),
      width: o.width,
      height: o.height,
      settings: o.settings || {},
      view,
      states: o.states || [],
      cities: o.cities || [],
      labels: o.labels || [],
      heights,
      moisture,
      stateMap,
      biomeMap,
    };
    // ältere Karten: Niederschlag neu berechnen (früher harte Kante zwischen West- und Ostwindgürtel)
    if ((map.settings.moistureV || 1) < FMM.MOISTURE_VERSION) {
      map.moisture = FMM.computeMoisture(map);
    }
    return map;
  };

  // ---------- Datei-Export/-Import (gzip, wenn verfügbar) ----------
  FMM.mapToBlob = async function (map) {
    const json = JSON.stringify(FMM.serializeMap(map));
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      return await new Response(stream).blob();
    }
    return new Blob([json], { type: 'application/json' });
  };

  FMM.mapFromFile = async function (file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let text;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann komprimierte Dateien nicht öffnen.');
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(buf);
    }
    return FMM.deserializeMap(JSON.parse(text));
  };

  FMM.downloadBlob = function (blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  FMM.safeFilename = function (name) {
    return (name || 'karte').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_') || 'karte';
  };

  // ---------- IndexedDB ----------
  const DB_NAME = 'fantasy-map-maker';
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('IndexedDB nicht verfügbar')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('maps', { keyPath: 'id' });
          d.createObjectStore('meta', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  function reqP(r) {
    return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  }

  FMM.Store = {
    async save(map, thumbnail) {
      const data = FMM.serializeMap(map);
      await tx('maps', 'readwrite', (s) => s.put({ id: map.id, name: map.name, updated: data.updated, thumbnail, width: map.width, height: map.height, data }));
      await tx('meta', 'readwrite', (s) => s.put({ id: 'last', mapId: map.id }));
    },
    async list() {
      const all = await tx('maps', 'readonly', (s) => reqP(s.getAll()));
      return (all || []).map((m) => ({ id: m.id, name: m.name, updated: m.updated, thumbnail: m.thumbnail, width: m.width, height: m.height }))
        .sort((a, b) => b.updated - a.updated);
    },
    async load(id) {
      const rec = await tx('maps', 'readonly', (s) => reqP(s.get(id)));
      if (!rec) throw new Error('Karte nicht gefunden');
      return FMM.deserializeMap(rec.data);
    },
    async remove(id) {
      await tx('maps', 'readwrite', (s) => s.delete(id));
    },
    async lastId() {
      const rec = await tx('meta', 'readonly', (s) => reqP(s.get('last')));
      return rec ? rec.mapId : null;
    },
  };
})();
