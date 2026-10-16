/* Abgeleitete Daten: Klima, Gewässer (Flüsse & Seen), Küstenabstand, Staatsinfos.
   Diese Daten werden nicht gespeichert, sondern immer aus Höhen/Staaten neu berechnet. */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Klimazonen als Breitengrad-Bereich der Karte (oben → unten, Süden negativ)
  const CLIMATES = {
    gemaessigt: { label: 'Gemäßigt (70°–25° N)', latTop: 70, latBottom: 25 },
    kalt: { label: 'Kalt (85°–45° N)', latTop: 85, latBottom: 45 },
    warm: { label: 'Warm / Tropisch (50° N – Äquator)', latTop: 50, latBottom: 0 },
    aequator: { label: 'Äquator in der Mitte (72° N – 72° S)', latTop: 72, latBottom: -72 },
    sued: { label: 'Südhalbkugel (25°–75° S)', latTop: -25, latBottom: -75 },
  };
  FMM.CLIMATES = CLIMATES;

  // Geografische Breite in Grad pro Zeile
  function latitudes(map) {
    const H = map.height;
    const c = CLIMATES[map.settings.climate] || CLIMATES.gemaessigt;
    const lat = new Float32Array(H);
    for (let y = 0; y < H; y++) lat[y] = c.latTop + (c.latBottom - c.latTop) * (y / (H - 1));
    return lat;
  }

  // Grundtemperatur aus der Breite (1 ≈ Äquator, 0,6 ≈ 40°, 0,25 ≈ 65°, < 0 polar)
  FMM.latToTemp = (lat) => 1.0 - 1.15 * Math.pow(Math.min(90, Math.abs(lat)) / 90, 1.3);

  function latitudeTemps(map) {
    const lat = latitudes(map);
    const t = new Float32Array(lat.length);
    for (let y = 0; y < lat.length; y++) t[y] = FMM.latToTemp(lat[y]);
    return t;
  }

  // Temperatur einer Zelle inkl. Höhenabkühlung
  FMM.cellTemp = function (latT, h) {
    return latT - (h > 0 ? h * 0.5 : 0);
  };

  // ---------- Hydrologie: Senkenfüllung (Priority-Flood), Abfluss, Seen, Flüsse ----------
  function hydrology(map, d) {
    const W = map.width, H = map.height, N = W * H;
    const h = map.heights, moist = map.moisture;
    const filled = new Float32Array(N);
    const down = new Int32Array(N).fill(-1);
    const visited = new Uint8Array(N);
    const order = new Int32Array(N);
    let oc = 0;
    const heap = new FMM.MinHeap(Math.max(1024, (W + H) * 8));

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (h[i] < 0) {
          visited[i] = 1;
          filled[i] = h[i];
          // Küstenzellen im Meer als Startpunkte
          let coast = false;
          for (let k = 0; k < 4 && !coast; k++) {
            const nx = x + FMM.N4[k][0], ny = y + FMM.N4[k][1];
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && h[ny * W + nx] >= 0) coast = true;
          }
          if (coast) heap.push(i, h[i]);
        } else if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
          visited[i] = 1;
          filled[i] = h[i];
          order[oc++] = i;
          heap.push(i, h[i]);
        }
      }
    }

    const N8 = FMM.N8;
    while (heap.size > 0) {
      const c = heap.pop();
      const cx = c % W, cy = (c / W) | 0;
      const fc = filled[c];
      for (let k = 0; k < 8; k++) {
        const nx = cx + N8[k][0], ny = cy + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (visited[n]) continue;
        visited[n] = 1;
        // leicht zufälliges Gefälle über Ebenen → natürlichere Flussläufe statt Geraden
        const eps = 1e-5 * (1 + FMM.hash2(nx, ny) * 3);
        const f = h[n] > fc + eps ? h[n] : fc + eps;
        filled[n] = f;
        down[n] = c;
        order[oc++] = n;
        heap.push(n, f);
      }
    }

    // Abflussmenge: von oben nach unten aufsummieren
    const density = map.settings.riverDensity || 1;
    const T = (N * 0.0005) / density;
    const flux = new Float32Array(N);
    // gezeichnete Flüsse: Quellen speisen zusätzlich Wasser ein, damit der Fluss ab dort sichtbar ist
    for (const s of map.springs || []) {
      const i = FMM.clamp(Math.floor(s.y), 0, H - 1) * W + FMM.clamp(Math.floor(s.x), 0, W - 1);
      if (h[i] >= 0) flux[i] += T * 1.3;
    }
    for (let k = oc - 1; k >= 0; k--) {
      const c = order[k];
      flux[c] += 0.25 + moist[c];
      const dn = down[c];
      if (dn >= 0) flux[dn] += flux[c];
    }

    // Seen: gefüllte Senken mit ausreichender Tiefe und Größe
    const lake = new Uint8Array(N);
    const cand = new Uint8Array(N);
    const lakeDepth = 0.004;
    for (let i = 0; i < N; i++) if (h[i] >= 0 && filled[i] - h[i] > lakeDepth) cand[i] = 1;
    const minLake = Math.max(8, Math.round(N / 40000));
    const stack = new Int32Array(N);
    const comp = [];
    for (let i = 0; i < N; i++) {
      if (cand[i] !== 1) continue;
      let sp = 0;
      stack[sp++] = i;
      cand[i] = 2;
      comp.length = 0;
      while (sp > 0) {
        const c = stack[--sp];
        comp.push(c);
        const cx = c % W, cy = (c / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = cx + FMM.N4[k][0], ny = cy + FMM.N4[k][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (cand[n] === 1) { cand[n] = 2; stack[sp++] = n; }
        }
      }
      if (comp.length >= minLake) for (const c of comp) lake[c] = 1;
    }

    // Flüsse
    const isRiver = new Uint8Array(N);
    const upCount = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (h[i] >= 0 && flux[i] >= T) isRiver[i] = 1;
    for (let i = 0; i < N; i++) if (isRiver[i] && down[i] >= 0 && upCount[down[i]] < 255) upCount[down[i]]++;
    const done = new Uint8Array(N);
    const rivers = [];
    for (let i = 0; i < N; i++) {
      if (!isRiver[i] || upCount[i] > 0) continue;
      const path = [i];
      done[i] = 1;
      let c = i;
      for (;;) {
        const dn = down[c];
        if (dn < 0) break;
        path.push(dn);
        if (!isRiver[dn] || done[dn]) break;
        done[dn] = 1;
        c = dn;
      }
      if (path.length >= 3) rivers.push(path);
    }

    // Abstand zum nächsten Fluss/See (für Auwälder und grüne Flusstäler), max. 8 Zellen
    const riverDist = new Uint8Array(N).fill(255);
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (isRiver[i] || lake[i]) { riverDist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const c = q[qh++];
      const dc = riverDist[c];
      if (dc >= 8) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + FMM.N4[k][0], ny = cy + FMM.N4[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (riverDist[n] !== 255) continue;
        riverDist[n] = dc + 1;
        q[qt++] = n;
      }
    }

    d.riverDist = riverDist;

    // Geländekrümmung: Höhe minus geglättete Umgebung (>0 Grate, <0 Täler) für plastisches Relief
    const r = 4, hb = new Float32Array(N), tmp = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += Math.max(0, h[row + FMM.clamp(x, 0, W - 1)]);
      for (let x = 0; x < W; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += Math.max(0, h[row + Math.min(W - 1, x + r + 1)]) - Math.max(0, h[row + Math.max(0, x - r)]);
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[FMM.clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        hb[y * W + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    for (let i = 0; i < N; i++) hb[i] = Math.max(0, h[i]) - hb[i];
    d.curv = hb;
    d.filled = filled;
    d.down = down;
    d.flux = flux;
    d.lake = lake;
    d.isRiver = isRiver;
    d.rivers = rivers;
    d.riverThreshold = T;
  }

  // ---------- Abstand zur Küste (Land→Meer und Meer→Land), 4er-BFS ----------
  function coastDistance(map, d) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const dist = new Uint8Array(N).fill(255);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const w = h[i] < 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + FMM.N4[k][0], ny = y + FMM.N4[k][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if ((h[ny * W + nx] < 0) !== w) { dist[i] = 0; queue[qt++] = i; break; }
        }
      }
    }
    while (qh < qt) {
      const c = queue[qh++];
      const dc = dist[c];
      if (dc >= 254) continue;
      const cx = c % W, cy = (c / W) | 0;
      const w = h[c] < 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + FMM.N4[k][0], ny = cy + FMM.N4[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (dist[n] !== 255 || (h[n] < 0) !== w) continue;
        dist[n] = dc + 1;
        queue[qt++] = n;
      }
    }
    d.coastDist = dist;
  }

  // ---------- Staaten: Grenzabstand, Fläche, Beschriftungsposition ----------
  function politics(map, d) {
    const W = map.width, H = map.height, N = W * H, h = map.heights, sm = map.stateMap;
    const dist = new Uint16Array(N).fill(65535);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (h[i] < 0) continue;
        const s = sm[i];
        let edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
        for (let k = 0; k < 4 && !edge; k++) {
          const n = (y + FMM.N4[k][1]) * W + x + FMM.N4[k][0];
          if (h[n] < 0 || sm[n] !== s) edge = true;
        }
        if (edge) { dist[i] = 0; queue[qt++] = i; }
      }
    }
    while (qh < qt) {
      const c = queue[qh++];
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + FMM.N4[k][0], ny = cy + FMM.N4[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (dist[n] !== 65535 || h[n] < 0) continue;
        dist[n] = dist[c] + 1;
        queue[qt++] = n;
      }
    }

    // Statistiken pro Staat
    const info = {};
    for (const s of map.states) info[s.id] = { area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, best: -1, bestD: -1 };
    for (let i = 0; i < N; i++) {
      if (h[i] < 0) continue;
      const st = info[sm[i]];
      if (!st) continue;
      st.area++;
      if (dist[i] > st.bestD) { st.bestD = dist[i]; st.best = i; }
    }
    // Ausrichtung nur aus dem Kerngebiet um den Beschriftungspunkt bestimmen (Exklaven ignorieren)
    for (const id in info) {
      const st = info[id];
      if (st.area === 0) continue;
      st.px = st.best % W; st.py = (st.best / W) | 0;
      st.r2 = Math.pow(Math.max(st.bestD * 3, Math.sqrt(st.area) * 0.75), 2);
      st.n = 0;
    }
    for (let i = 0; i < N; i++) {
      if (h[i] < 0) continue;
      const st = info[sm[i]];
      if (!st) continue;
      const x = i % W, y = (i / W) | 0;
      const dx = x - st.px, dy = y - st.py;
      if (dx * dx + dy * dy > st.r2) continue;
      st.n++;
      st.sx += x; st.sy += y;
      st.sxx += x * x; st.syy += y * y; st.sxy += x * y;
    }
    for (const id in info) {
      const st = info[id];
      if (st.area === 0 || st.n === 0) continue;
      const mx = st.sx / st.n, my = st.sy / st.n;
      const cxx = st.sxx / st.n - mx * mx;
      const cyy = st.syy / st.n - my * my;
      const cxy = st.sxy / st.n - mx * my;
      // Hauptachse (für schräge Beschriftung)
      let angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
      const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const elong = l2 > 0 ? Math.sqrt(l1 / l2) : 10;
      if (elong < 1.6) angle = 0;
      angle = FMM.clamp(angle, -0.6, 0.6);
      st.angle = angle;
      st.length = Math.sqrt(Math.max(l1, 1)) * 2.6;
      st.cx = mx; st.cy = my;
      st.lx = (st.best % W) + 0.5;
      st.ly = ((st.best / W) | 0) + 0.5;
      st.poleDist = st.bestD;
    }
    d.borderDist = dist;
    d.stateInfo = info;
  }

  FMM.Derive = {
    latitudeTemps,
    latitudes,
    hydrology,
    coastDistance,
    politics,
    all(map) {
      const d = { latT: latitudeTemps(map) };
      coastDistance(map, d);
      hydrology(map, d);
      politics(map, d);
      return d;
    },
  };
})();
