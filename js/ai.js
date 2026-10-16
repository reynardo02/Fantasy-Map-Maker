/* KI-Assistent: Chat, in dem man beschreibt, wie die Karte aussehen soll – Claude setzt es mit Werkzeugen um.
   Läuft komplett im Browser mit dem eigenen Anthropic-API-Schlüssel des Nutzers (bleibt im localStorage). */
(function () {
  'use strict';
  const FMM = window.FMM;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
  const MODEL = 'claude-opus-5-5';
  const KEY_STORE = 'fmm.apiKey';
  const WS_STORE = 'fmm.workspaceId';
  const MAX_STEPS = 25;
  // Preise Claude Opus 5.5 in $ pro Million Token (Eingabe, Ausgabe, Cache lesen, Cache schreiben)
  const PRICE = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 };

  // ---------- Werkzeuge für Claude ----------
  const point = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] in Prozent der Kartenbreite bzw. -höhe (0–100, oben links = 0,0)' };
  const outline = { type: 'array', items: point, minItems: 3, maxItems: 60, description: 'Umriss als Liste von [x, y]-Punkten in Prozent, im Uhrzeigersinn. Die Küste wird automatisch natürlich ausgefranst.' };
  const line = { type: 'array', items: point, minItems: 2, maxItems: 40, description: 'Linie als Liste von [x, y]-Punkten in Prozent' };
  const tool = (name, description, properties, required) => ({
    name, description,
    input_schema: { type: 'object', properties, required: required || [], additionalProperties: false },
    eager_input_streaming: true,
  });

  const TOOLS = [
    tool('view_map', 'Zeigt ein aktuelles Bild der Karte und eine Textübersicht (Landmassen, Gebirge, Staaten, Städte, Orte, Beschriftungen mit Koordinaten in Prozent). Nach größeren Änderungen zur Kontrolle nutzen.', {}),
    tool('get_overview', 'Nur die Textübersicht der Karte (ohne Bild).', {}),
    tool('add_landmass', 'Schüttet Land in einem Umriss auf (neuer Kontinent, Insel, Halbinsel, Land verbinden). Bestehendes Land bleibt erhalten.', {
      outline,
      relief: { type: 'string', enum: ['flach', 'huegelig', 'bergig'], description: 'Grundrelief im Inneren' },
    }, ['outline']),
    tool('remove_land', 'Versenkt Land innerhalb eines Umrisses im Meer (Buchten, Meerengen, Binnenmeere, Inseln abtrennen).', { outline }, ['outline']),
    tool('add_mountain_range', 'Legt einen Gebirgszug entlang einer Linie an (mit Graten, Pässen, Schnee in der Höhe). Auf Meer entstehen Inselketten.', {
      path: line,
      width: { type: 'number', minimum: 0.8, maximum: 12, description: 'halbe Breite in Prozent der Kartenhöhe (typisch 2–5)' },
      height: { type: 'string', enum: ['niedrig', 'mittel', 'hoch', 'gewaltig'] },
    }, ['path']),
    tool('carve_river', 'Zeichnet einen Fluss von der Quelle (erster Punkt) zur Mündung (letzter Punkt, idealerweise an der Küste oder in einem See).', { path: line }, ['path']),
    tool('paint_landscape', 'Legt in einem Umriss eine Landschaftsform fest (z. B. Wüste, Wald). „automatisch“ entfernt solche Festlegungen wieder.', {
      outline,
      landscape: { type: 'string', enum: [], description: 'Landschaftsform' },
    }, ['outline', 'landscape']),
    tool('move_landmass', 'Verschiebt, dreht und/oder skaliert die Landmasse an einem Punkt (mit Städten, Orten und Namen).', {
      at: point,
      dx: { type: 'number', description: 'Verschiebung nach rechts in Prozent der Kartenbreite' },
      dy: { type: 'number', description: 'Verschiebung nach unten in Prozent der Kartenhöhe' },
      rotate_deg: { type: 'number', description: 'Drehung im Uhrzeigersinn in Grad' },
      scale: { type: 'number', minimum: 0.3, maximum: 3, description: 'Größenfaktor (1 = unverändert)' },
    }, ['at']),
    tool('reroll_region', 'Erzeugt das Gelände innerhalb eines Umrisses zufällig neu (weich eingeblendet).', { outline }, ['outline']),
    tool('set_climate', 'Ändert Klimazone (Breitengrad-Bereich der Karte) und/oder Windrichtung. Niederschlag, Flüsse und Landschaften werden neu berechnet.', {
      climate: { type: 'string', enum: [] },
      wind: { type: 'string', enum: [] },
    }),
    tool('regenerate_world', 'Erzeugt eine komplett neue Welt. NUR verwenden, wenn der Nutzer ausdrücklich eine ganz neue Karte möchte – alle Änderungen gehen verloren und lassen sich nicht rückgängig machen.', {
      land_type: { type: 'string', enum: [] },
      land_fraction: { type: 'number', minimum: 0.1, maximum: 0.9 },
      mountains: { type: 'number', minimum: 0, maximum: 1 },
      climate: { type: 'string', enum: [] },
      seed: { type: 'string' },
    }),
    tool('place_city', 'Setzt eine Stadt auf Land.', {
      at: point,
      name: { type: 'string', description: 'leer lassen für einen passenden Zufallsnamen' },
      type: { type: 'string', enum: ['capital', 'city', 'town'], description: 'Hauptstadt, Stadt oder Dorf' },
    }, ['at']),
    tool('add_poi', 'Setzt eine Sehenswürdigkeit (Ruine, Turm, Tempel, Vulkan …).', {
      at: point,
      type: { type: 'string', enum: [] },
      name: { type: 'string' },
    }, ['at', 'type']),
    tool('add_label', 'Setzt eine freie Beschriftung (z. B. Name eines Meeres, einer Region).', {
      at: point,
      text: { type: 'string' },
      kind: { type: 'string', enum: ['titel', 'gewaesser'], description: 'titel = Kapitälchen, gewaesser = kursiv für Meere/Seen' },
      size: { type: 'number', minimum: 8, maximum: 40 },
    }, ['at', 'text']),
    tool('rename', 'Benennt eine Stadt, einen Ort, eine Beschriftung oder einen Staat um (Ziel über ID oder aktuellen Namen).', {
      target: { type: 'string' },
      new_name: { type: 'string' },
    }, ['target', 'new_name']),
    tool('delete_object', 'Löscht eine Stadt, einen Ort oder eine Beschriftung (Ziel über ID oder Namen).', { target: { type: 'string' } }, ['target']),
    tool('regenerate_names', 'Benennt Gebirge, Wälder, Wüsten, Sümpfe, Seen und große Flüsse neu (nach Geländeänderungen sinnvoll).', {}),
  ];

  function fillEnums() {
    const set = (name, prop, values) => { TOOLS.find((t) => t.name === name).input_schema.properties[prop].enum = values; };
    set('paint_landscape', 'landscape', ['automatisch', ...FMM.BIOMES.map((b) => b.key)]);
    set('set_climate', 'climate', Object.keys(FMM.CLIMATES));
    set('set_climate', 'wind', Object.keys(FMM.WINDS));
    set('regenerate_world', 'land_type', Object.keys(FMM.LAND_TYPES));
    set('regenerate_world', 'climate', Object.keys(FMM.CLIMATES));
    set('add_poi', 'type', Object.keys(FMM.POI_TYPES));
  }

  // einfache Prüfung der Werkzeug-Eingaben gegen das Schema (Eingaben werden gestreamt und nicht vom Server geprüft)
  function validate(schema, v, path) {
    path = path || 'Eingabe';
    if (schema.enum && !schema.enum.includes(v)) return `${path}: unbekannter Wert ${JSON.stringify(v)}`;
    if (schema.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `${path}: Objekt erwartet`;
      for (const k of schema.required || []) if (!(k in v)) return `${path}.${k} fehlt`;
      for (const [k, sub] of Object.entries(schema.properties || {})) if (k in v) { const e = validate(sub, v[k], `${path}.${k}`); if (e) return e; }
    } else if (schema.type === 'array') {
      if (!Array.isArray(v)) return `${path}: Liste erwartet`;
      if (schema.minItems && v.length < schema.minItems) return `${path}: mindestens ${schema.minItems} Einträge`;
      if (schema.maxItems && v.length > schema.maxItems) return `${path}: höchstens ${schema.maxItems} Einträge`;
      for (let k = 0; k < v.length; k++) { const e = validate(schema.items, v[k], `${path}[${k}]`); if (e) return e; }
    } else if (schema.type === 'number') {
      if (typeof v !== 'number' || !isFinite(v)) return `${path}: Zahl erwartet`;
    } else if (schema.type === 'string') {
      if (typeof v !== 'string') return `${path}: Text erwartet`;
    }
    return null;
  }

  const SYSTEM = `Du bist der Karten-Assistent im „Fantasy Map Maker“, einem Werkzeug für Fantasy-Weltkarten. Der Nutzer beschreibt auf Deutsch, wie seine Welt aussehen soll, und du setzt das mit den Werkzeugen direkt auf der Karte um.

Koordinaten: Alle Positionen sind Prozent der Kartenbreite (x) bzw. -höhe (y), 0–100, oben links ist (0, 0), Norden ist oben. Die Karte ist meist breiter als hoch – beachte das Seitenverhältnis aus der Übersicht, damit Formen nicht verzerrt werden.

Vorgehen:
- Arbeite von grob nach fein: erst Landmassen (add_landmass / remove_land), dann Gebirgszüge, dann Flüsse und Landschaften, zuletzt Städte, Orte und Namen.
- Umrisse dürfen grob sein (8–25 Punkte); Küsten werden automatisch natürlich. Für lange, schmale Formen genügend Punkte entlang des Randes setzen.
- Prüfe nach größeren Änderungen mit view_map, ob das Ergebnis zur Beschreibung passt, und bessere gezielt nach.
- Ändere nur, worum der Nutzer bittet; lass den Rest der Karte in Ruhe. regenerate_world nur auf ausdrücklichen Wunsch.

Plausible Geografie (wenn der Nutzer nichts anderes sagt): Gebirgsketten sind lang und schmal, oft parallel zu einer Küste oder zwischen zwei Landmassen; Flüsse entspringen im Gebirge oder Hügelland und münden ins Meer oder in Seen; Wüsten liegen im Regenschatten von Gebirgen, im Inneren großer Kontinente oder um 20–30° Breite; Wälder an feuchten Küsten und Luvseiten. Das Klima der Karte (Breitengrade, Wind) steht in der Übersicht.

Antworte kurz und freundlich auf Deutsch. Fasse am Ende in ein bis drei Sätzen zusammen, was du geändert hast. Alle Änderungen einer Antwort lassen sich vom Nutzer mit einem Klick rückgängig machen.`;

  // ---------- Kartenübersicht für Claude ----------
  function overview(app) {
    const map = app.map, d = app.d, W = map.width, H = map.height, h = map.heights, N = W * H;
    const pc = (x, y) => `${(x / W * 100).toFixed(1)}, ${(y / H * 100).toFixed(1)}`;
    const clim = FMM.CLIMATES[map.settings.climate] || FMM.CLIMATES.gemaessigt;
    const out = [];
    out.push(`Karte „${map.name}“, ${W} × ${H} Zellen (Seitenverhältnis ${(W / H).toFixed(2)} : 1), ca. ${Math.round(W * (map.settings.kmPerPixel || 4))} km breit.`);
    out.push(`Klima: ${clim.label} (Option „${map.settings.climate || 'gemaessigt'}“), Wind: ${FMM.WINDS[map.settings.wind || 'auto']}.`);
    // Landmassen und Gebirge (zusammenhängende Gebiete)
    const regions = (test, minFrac) => {
      const seen = new Uint8Array(N), q = new Int32Array(N), res = [];
      for (let i = 0; i < N; i++) {
        if (seen[i] || !test(i)) continue;
        let a = 0, b = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
        q[b++] = i; seen[i] = 1;
        while (a < b) {
          const c = q[a++], cx = c % W, cy = (c / W) | 0;
          if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
          for (const n of [c - 1, c + 1, c - W, c + W]) if (n >= 0 && n < N && !seen[n] && test(n)) { seen[n] = 1; q[b++] = n; }
        }
        if (b >= N * minFrac) res.push({ n: b, x0, y0, x1, y1 });
      }
      return res.sort((p, q2) => q2.n - p.n);
    };
    let land = 0;
    for (let i = 0; i < N; i++) if (h[i] >= 0) land++;
    out.push(`Landanteil: ${Math.round(land / N * 100)} %.`);
    const lm = regions((i) => h[i] >= 0, 0.002).slice(0, 15);
    out.push('Landmassen (Rahmen x0,y0 – x1,y1 in %; Anteil an der Karte):');
    lm.forEach((r, k) => out.push(`  ${k + 1}. ${pc(r.x0, r.y0)} – ${pc(r.x1, r.y1)}; ${(r.n / N * 100).toFixed(1)} %`));
    const mt = regions((i) => h[i] > 0.45, 0.0004).slice(0, 12);
    if (mt.length) {
      out.push('Gebirge (Höhe > 0,45):');
      mt.forEach((r) => out.push(`  ${pc(r.x0, r.y0)} – ${pc(r.x1, r.y1)}`));
    }
    if (map.states.length) {
      out.push('Staaten:');
      for (const s of map.states.slice(0, 30)) {
        const info = d.stateInfo && d.stateInfo[s.id];
        out.push(`  ${s.form} ${s.name} (Kultur ${s.culture})${info ? ' um ' + pc(info.lx, info.ly) : ''}`);
      }
    }
    const stateName = (x, y) => { const s = map.states.find((o) => o.id === map.stateMap[(y | 0) * W + (x | 0)]); return s ? s.name : 'herrenlos'; };
    if (map.cities.length) {
      out.push(`Städte (${map.cities.length}; ID, Name, Typ, Position %, Staat):`);
      for (const c of map.cities.slice(0, 80)) out.push(`  ${c.id}: ${c.name}, ${c.type}, ${pc(c.x, c.y)}, ${stateName(c.x, c.y)}`);
    }
    if (map.pois && map.pois.length) {
      out.push('Sehenswürdigkeiten:');
      for (const p of map.pois.slice(0, 40)) out.push(`  ${p.id}: ${p.name} (${FMM.POI_TYPES[p.type] || p.type}), ${pc(p.x, p.y)}`);
    }
    if (map.labels.length) {
      out.push('Beschriftungen:');
      for (const l of map.labels.slice(0, 50)) out.push(`  ${l.id}: „${l.text}“ (${l.kind === 'sea' ? 'Gewässer' : l.kind === 'river' ? 'Fluss' : l.kind === 'region' ? 'Landschaft' : 'Text'}), ${pc(l.x, l.y)}`);
    }
    return out.join('\n');
  }

  function mapImage(app) {
    const factor = Math.min(1, 900 / app.map.width);
    const c = app.renderer.exportCanvas(app.map, app.d, factor);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  // ---------- Ausführen der Werkzeuge ----------
  function makeExecutor(app) {
    const map = () => app.map;
    const W = () => app.map.width, H = () => app.map.height;
    const cell = ([x, y]) => [FMM.clamp(x, 0, 100) / 100 * W(), FMM.clamp(y, 0, 100) / 100 * H()];
    const cells = (pts) => pts.map(cell);
    const S = FMM.Sculpt;
    const sculpt = (fn) => app.applySculpt(null, fn, { noHistory: true, quiet: true });
    const findTarget = (t) => {
      const m = map(), q = String(t).trim().toLowerCase();
      const all = [
        ...m.cities.map((o) => ({ kind: 'city', o, name: o.name })),
        ...(m.pois || []).map((o) => ({ kind: 'poi', o, name: o.name })),
        ...m.labels.map((o) => ({ kind: 'label', o, name: o.text })),
        ...m.states.map((o) => ({ kind: 'state', o, name: o.name })),
      ];
      return all.find((e) => String(e.o.id).toLowerCase() === q) || all.find((e) => e.name && e.name.toLowerCase() === q) || all.find((e) => e.name && e.name.toLowerCase().includes(q));
    };
    const cultureAt = (x, y) => { const m = map(); const s = m.states.find((o) => o.id === m.stateMap[(y | 0) * m.width + (x | 0)]); return s ? s.culture : 'germanisch'; };
    const refresh = () => { app.editor.requestDraw(); app.changed(); };

    return {
      view_map() { return [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: mapImage(app) } }, { type: 'text', text: overview(app) }]; },
      get_overview() { return overview(app); },
      add_landmass(a) { sculpt((m) => S.addLandmass(m, cells(a.outline), { relief: a.relief || 'huegelig' })); return 'Land aufgeschüttet.'; },
      remove_land(a) { sculpt((m) => S.removeLand(m, cells(a.outline))); return 'Land versenkt.'; },
      add_mountain_range(a) {
        const height = { niedrig: 0.3, mittel: 0.5, hoch: 0.7, gewaltig: 0.9 }[a.height || 'hoch'];
        const width = ((a.width || 3.5) / 100) * H();
        sculpt((m) => S.addMountainRange(m, cells(a.path), { width, height }));
        return 'Gebirgszug angelegt.';
      },
      carve_river(a) { sculpt((m) => S.carveRiver(m, cells(a.path))); return 'Fluss eingezeichnet.'; },
      paint_landscape(a) {
        const id = a.landscape === 'automatisch' ? 255 : FMM.BIOME_ID[a.landscape];
        sculpt((m) => S.paintBiome(m, cells(a.outline), id));
        return 'Landschaft festgelegt.';
      },
      move_landmass(a) {
        const [x, y] = cell(a.at);
        const lm = S.landmassAt(map(), x, y);
        if (!lm) throw new Error('An diesem Punkt (und in der Nähe) ist keine Landmasse.');
        sculpt((m) => S.transformLandmass(m, lm, { dx: (a.dx || 0) / 100 * W(), dy: (a.dy || 0) / 100 * H(), angle: ((a.rotate_deg || 0) * Math.PI) / 180, scale: a.scale || 1 }));
        return 'Landmasse bewegt.';
      },
      reroll_region(a) { sculpt((m) => S.rerollRegion(m, cells(a.outline))); return 'Region neu erzeugt.'; },
      set_climate(a) {
        const m = map();
        if (a.climate) m.settings.climate = a.climate;
        if (a.wind) m.settings.wind = a.wind;
        app.d.latT = FMM.Derive.latitudeTemps(m);
        app.history.newVersion('terrain');
        m.moisture = FMM.computeMoisture(m);
        app.afterTerrainEdit(null);
        app.syncUi();
        return `Klima jetzt: ${FMM.CLIMATES[m.settings.climate].label}, Wind: ${FMM.WINDS[m.settings.wind || 'auto']}.`;
      },
      regenerate_world(a) {
        const old = map();
        const params = {
          name: old.name, width: old.width, height: old.height,
          seed: a.seed || FMM.randomSeed(),
          landType: a.land_type || old.settings.landType, landFraction: a.land_fraction || old.settings.landFraction,
          mountains: a.mountains != null ? a.mountains : old.settings.mountains, climate: a.climate || old.settings.climate,
          stateCount: old.settings.stateCount, cityCount: old.settings.cityCount, culture: old.settings.culture, erosion: old.settings.erosion,
          featureScale: old.settings.featureScale, riverDensity: old.settings.riverDensity, wind: old.settings.wind, kmPerPixel: old.settings.kmPerPixel,
        };
        const m = FMM.generateMap(params);
        m.view = old.view;
        app.setMap(m);
        app.changed(true);
        return 'Neue Welt erzeugt (Seed ' + params.seed + ').';
      },
      place_city(a) {
        const m = map(), [x, y] = cell(a.at);
        if (m.heights[(y | 0) * m.width + (x | 0)] < 0) throw new Error('Städte können nur auf Land stehen.');
        const st = m.states.find((o) => o.id === m.stateMap[(y | 0) * m.width + (x | 0)]);
        let type = a.type || 'city';
        if (type === 'capital' && !st) type = 'city';
        const c = { id: FMM.uid(), x, y, type, name: a.name || app.nameGen().name(cultureAt(x, y)) };
        if (type === 'capital') {
          const old = m.cities.find((o) => o.id === st.capital);
          if (old) old.type = 'city';
          st.capital = c.id;
        }
        m.cities.push(c);
        refresh();
        return `Stadt „${c.name}“ (${c.id}) gesetzt.`;
      },
      add_poi(a) {
        const m = map(), [x, y] = cell(a.at);
        if (!m.pois) m.pois = [];
        const p = { id: FMM.uid(), type: a.type, x, y, name: a.name || FMM.poiName(app.nameGen(), a.type, cultureAt(x, y)) };
        m.pois.push(p);
        m.view.layers.pois = true;
        refresh();
        return `Ort „${p.name}“ (${p.id}) gesetzt.`;
      },
      add_label(a) {
        const [x, y] = cell(a.at);
        const lb = { id: FMM.uid(), x, y, text: a.text, kind: a.kind === 'gewaesser' ? 'sea' : 'custom', size: a.size || 16, angle: 0 };
        map().labels.push(lb);
        refresh();
        return `Beschriftung „${lb.text}“ (${lb.id}) gesetzt.`;
      },
      rename(a) {
        const t = findTarget(a.target);
        if (!t) throw new Error(`„${a.target}“ nicht gefunden.`);
        if (t.kind === 'label') t.o.text = a.new_name; else t.o.name = a.new_name;
        refresh();
        return `„${t.name}“ heißt jetzt „${a.new_name}“.`;
      },
      delete_object(a) {
        const t = findTarget(a.target);
        if (!t || t.kind === 'state') throw new Error(`„${a.target}“ nicht gefunden (Staaten lassen sich hier nicht löschen).`);
        const m = map();
        if (t.kind === 'city') { m.cities = m.cities.filter((o) => o !== t.o); for (const s of m.states) if (s.capital === t.o.id) s.capital = null; }
        if (t.kind === 'poi') m.pois = m.pois.filter((o) => o !== t.o);
        if (t.kind === 'label') m.labels = m.labels.filter((o) => o !== t.o);
        refresh();
        return `„${t.name}“ gelöscht.`;
      },
      regenerate_names() {
        const m = map();
        m.labels = m.labels.filter((l) => l.kind !== 'region' && l.kind !== 'river');
        const labels = FMM.generateRegionLabels(m, app.d, FMM.makeRng(Math.random()));
        m.labels.push(...labels);
        refresh();
        return labels.length + ' Landschafts- und Flussnamen vergeben: ' + labels.map((l) => l.text).join(', ');
      },
    };
  }

  const MUTATING = new Set(['add_landmass', 'remove_land', 'add_mountain_range', 'carve_river', 'paint_landscape', 'move_landmass', 'reroll_region', 'set_climate', 'place_city', 'add_poi', 'add_label', 'rename', 'delete_object', 'regenerate_names']);
  const STEP_TEXT = {
    view_map: 'Schaue mir die Karte an', get_overview: 'Lese die Übersicht', add_landmass: 'Schütte Land auf', remove_land: 'Versenke Land',
    add_mountain_range: 'Falte ein Gebirge auf', carve_river: 'Zeichne einen Fluss', paint_landscape: 'Lege eine Landschaft fest', move_landmass: 'Bewege eine Landmasse',
    reroll_region: 'Würfle eine Region neu', set_climate: 'Ändere das Klima', regenerate_world: 'Erschaffe eine neue Welt', place_city: 'Setze eine Stadt',
    add_poi: 'Setze einen Ort', add_label: 'Setze eine Beschriftung', rename: 'Benenne um', delete_object: 'Lösche', regenerate_names: 'Vergebe Landschaftsnamen',
  };

  // ---------- Chat ----------
  const AI = {
    messages: [],
    running: false,
    stream: null,
    sdk: null,
    useFallbacks: true,
    totalCost: 0,

    init(app) {
      this.app = app;
      fillEnums();
      this.exec = makeExecutor(app);
      $('btnAi').onclick = () => this.toggle();
      $('aiClose').onclick = () => this.toggle(false);
      $('aiSettingsBtn').onclick = () => this.showSettings(true);
      $('aiNew').onclick = () => this.reset();
      $('aiSend').onclick = () => (this.running ? this.stop() : this.send());
      $('aiInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!this.running) this.send(); }
        e.stopPropagation();
      });
      $('aiInput').addEventListener('keyup', (e) => e.stopPropagation());
      $('aiKeySave').onclick = () => {
        const k = $('aiKey').value.trim();
        try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) { /* privater Modus */ }
        this.memKey = k;
        const w = $('aiWorkspace').value.trim();
        try { if (w) localStorage.setItem(WS_STORE, w); else localStorage.removeItem(WS_STORE); } catch (e) { /* privater Modus */ }
        this.memWs = w;
        this.showSettings(false);
      };
      $('aiKeyRemove').onclick = () => {
        try { localStorage.removeItem(KEY_STORE); localStorage.removeItem(WS_STORE); } catch (e) { /* egal */ }
        this.memKey = '';
        this.memWs = '';
        $('aiKey').value = '';
        $('aiWorkspace').value = '';
      };
      this.renderEmpty();
    },

    apiKey() {
      if (this.memKey) return this.memKey;
      try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
    },

    workspaceId() {
      if (this.memWs) return this.memWs;
      try { return localStorage.getItem(WS_STORE) || ''; } catch (e) { return ''; }
    },

    toggle(open) {
      const p = $('aiPanel');
      p.hidden = open == null ? !p.hidden : !open;
      if (!p.hidden) {
        if (!this.apiKey()) this.showSettings(true);
        else setTimeout(() => $('aiInput').focus(), 0);
      }
    },

    showSettings(on) {
      $('aiSettings').hidden = !on;
      if (on) { $('aiKey').value = this.apiKey(); $('aiWorkspace').value = this.workspaceId(); }
    },

    reset() {
      if (this.running) return;
      this.messages = [];
      $('aiLog').innerHTML = '';
      this.renderEmpty();
    },

    renderEmpty() {
      if (this.messages.length) return;
      $('aiLog').innerHTML = `<div class="ai-hello">Beschreibe, wie deine Welt aussehen soll – zum Beispiel:
        <button class="ai-ex">Ein langgezogener Kontinent im Westen mit einer Gebirgskette an der Ostküste und einer Wüste im Süden.</button>
        <button class="ai-ex">Füge im Nordosten eine Inselkette mit Vulkanen hinzu.</button>
        <button class="ai-ex">Lass einen großen Fluss vom zentralen Gebirge nach Süden ins Meer fließen und setze eine Hafenstadt an die Mündung.</button></div>`;
      $('aiLog').querySelectorAll('.ai-ex').forEach((b) => (b.onclick = () => { $('aiInput').value = b.textContent.trim(); $('aiInput').focus(); }));
    },

    addBubble(cls, html) {
      const log = $('aiLog');
      const hello = log.querySelector('.ai-hello');
      if (hello) hello.remove();
      const div = document.createElement('div');
      div.className = 'ai-msg ' + cls;
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    },

    setStatus(text) {
      $('aiStatus').textContent = text || '';
    },

    async loadSdk() {
      if (this.sdk) return this.sdk;
      this.setStatus('Lade Claude-SDK …');
      this.sdk = await import(SDK_URL);
      return this.sdk;
    },

    stop() {
      this.aborted = true;
      if (this.stream) try { this.stream.abort(); } catch (e) { /* egal */ }
      this.setStatus('Abgebrochen.');
    },

    async send() {
      const text = $('aiInput').value.trim();
      if (!text || this.running) return;
      const key = this.apiKey();
      if (!key) { this.showSettings(true); return; }
      $('aiInput').value = '';
      this.addBubble('user', esc(text));
      // Kontext: Übersicht immer, Bild beim ersten Beitrag
      const content = [];
      if (!this.messages.length) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: mapImage(this.app) } });
      content.push({ type: 'text', text: `Aktuelle Karte:\n${overview(this.app)}\n\nWunsch des Nutzers:\n${text}` });
      this.messages.push({ role: 'user', content });
      this.running = true;
      this.aborted = false;
      this.historyPushed = false;
      $('aiSend').textContent = '■ Stopp';
      let cost = 0;
      try {
        const sdk = await this.loadSdk();
        const Anthropic = sdk.default || sdk.Anthropic;
        const ws = this.workspaceId();
        const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, defaultHeaders: ws ? { 'anthropic-workspace-id': ws } : undefined });
        for (let step = 0; step < MAX_STEPS && !this.aborted; step++) {
          this.setStatus(step ? 'Claude plant den nächsten Schritt …' : 'Claude denkt nach …');
          const msg = await this.request(client, sdk);
          cost += this.cost(msg.usage);
          this.messages.push({ role: 'assistant', content: msg.content });
          for (const b of msg.content) if (b.type === 'text' && b.text.trim()) this.addBubble('assistant', formatText(b.text));
          if (msg.stop_reason === 'refusal') { this.addBubble('note', 'Claude hat diese Anfrage abgelehnt. Formuliere sie bitte anders.'); break; }
          if (msg.stop_reason === 'max_tokens') { this.addBubble('note', 'Die Antwort wurde wegen der Längenbegrenzung abgeschnitten.'); }
          if (msg.stop_reason === 'pause_turn') continue;
          const uses = msg.content.filter((b) => b.type === 'tool_use');
          if (!uses.length) break;
          const results = [];
          for (const u of uses) results.push(await this.runTool(u));
          this.messages.push({ role: 'user', content: results });
          if (this.aborted) break;
          if (step === MAX_STEPS - 1) this.addBubble('note', 'Schrittgrenze erreicht – schreib „weiter“, wenn Claude fortfahren soll.');
        }
      } catch (e) {
        this.handleError(e);
      } finally {
        this.closeDanglingToolUse();
        this.running = false;
        this.stream = null;
        $('aiSend').textContent = 'Senden';
        this.totalCost += cost;
        this.setStatus(cost ? `Diese Antwort: ca. ${cost.toFixed(3)} $ · Gespräch: ca. ${this.totalCost.toFixed(2)} $` : '');
        if (this.historyPushed) this.addBubble('note', 'Alle Änderungen dieser Antwort lassen sich mit <b>Rückgängig</b> (Strg+Z) auf einmal zurücknehmen.');
      }
    },

    async request(client, sdk) {
      const params = {
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM,
        tools: TOOLS,
        messages: this.messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
      };
      if (this.useFallbacks) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
      try {
        this.stream = client.beta.messages.stream(params);
        return await this.stream.finalMessage();
      } catch (e) {
        // Konto/Plattform ohne Ausweichmodell: einmal ohne versuchen
        if (this.useFallbacks && e && e.status === 400 && /fallback/i.test(String(e.message))) {
          this.useFallbacks = false;
          return this.request(client, sdk);
        }
        throw e;
      }
    },

    async runTool(u) {
      const def = TOOLS.find((t) => t.name === u.name);
      const line = this.addBubble('step', `⚙ ${esc(STEP_TEXT[u.name] || u.name)} …`);
      this.setStatus((STEP_TEXT[u.name] || u.name) + ' …');
      const fail = (msg) => { line.classList.add('err'); line.innerHTML = `⚠ ${esc(STEP_TEXT[u.name] || u.name)}: ${esc(msg)}`; return { type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true }; };
      if (!def) return fail('Unbekanntes Werkzeug');
      const err = validate(def.input_schema, u.input);
      if (err) return fail('Ungültige Eingabe – ' + err);
      if (MUTATING.has(u.name) && !this.historyPushed) { this.app.history.push(); this.historyPushed = true; }
      await new Promise((r) => setTimeout(r, 10)); // Oberfläche aktualisieren lassen
      try {
        const res = this.exec[u.name](u.input);
        line.innerHTML = `✓ ${esc(STEP_TEXT[u.name] || u.name)}`;
        return { type: 'tool_result', tool_use_id: u.id, content: typeof res === 'string' ? res : res };
      } catch (e) {
        console.error(e);
        return fail(e.message || String(e));
      }
    },

    // nach Abbruch: offene tool_use-Blöcke beantworten, damit das Gespräch gültig bleibt
    closeDanglingToolUse() {
      const last = this.messages[this.messages.length - 1];
      if (!last || last.role !== 'assistant') return;
      const uses = (last.content || []).filter((b) => b.type === 'tool_use');
      if (uses.length) this.messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'Vom Nutzer abgebrochen.', is_error: true })) });
    },

    cost(u) {
      if (!u) return 0;
      return ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
    },

    handleError(e) {
      console.error(e);
      if (this.aborted) return;
      const st = e && e.status;
      let msg;
      if (st === 401) { msg = 'Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen (⚙) prüfen.'; this.showSettings(true); }
      else if (st === 403) msg = 'Keine Berechtigung für dieses Modell mit diesem Schlüssel.';
      else if (st === 429) msg = 'Zu viele Anfragen oder Ausgabenlimit erreicht. Bitte kurz warten und erneut versuchen.';
      else if (st === 529 || st === 503) msg = 'Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.';
      else if (st === 400 && /workspace/i.test(String(e.message))) {
        msg = 'Dein API-Schlüssel ist keinem Workspace zugeordnet. Trage in den Einstellungen (⚙) die Workspace-ID ein (Console → Settings → Workspaces) oder erstelle einen Schlüssel innerhalb eines Workspace.';
        this.showSettings(true);
        setTimeout(() => $('aiWorkspace').focus(), 0);
      }
      else if (st === 400) msg = 'Die Anfrage wurde abgelehnt: ' + String(e.message).slice(0, 300);
      else if (!st) msg = 'Keine Verbindung zur Claude-API (' + String((e && e.message) || e).slice(0, 160) + ').';
      else msg = `Fehler ${st}: ${String(e.message).slice(0, 200)}`;
      this.addBubble('note err', esc(msg));
      // fehlgeschlagene Nutzer-Nachricht entfernen, wenn noch keine Antwort kam
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'user' && last.content.some && last.content.some((b) => b.type === 'text')) this.messages.pop();
    },
  };

  // schlichte Formatierung: Absätze, **fett**, Aufzählungen
  function formatText(t) {
    return esc(t.trim())
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^[-•] (.*)$/gm, '• $1')
      .replace(/\n/g, '<br>');
  }

  FMM.AI = AI;
  FMM.AI._internals = { TOOLS, validate, overview, makeExecutor, fillEnums };
})();
