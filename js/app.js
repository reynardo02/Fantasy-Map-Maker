/* Anwendung: verbindet Generator, Renderer, Editor, Speicher und Oberfläche */
(function () {
  'use strict';
  const FMM = window.FMM;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BASE_LAYERS = new Set(['relief', 'stateFill', 'borders']);
  const CITY_TYPES = { capital: 'Hauptstadt', city: 'Stadt', town: 'Dorf' };

  const app = {
    map: null,
    d: null,
    renderer: new FMM.Renderer(),
    editor: null,
    history: null,
    selection: null,
    paintStateId: 1,
    terrainVersion: 0,
    stateVersion: 0,
    biomeVersion: 0,
    paintBiome: FMM.BIOME_ID.wald,
    newCityType: 'city',
    saveTimer: 0,
    uiTimer: 0,

    // ---------- Initialisierung ----------
    async init() {
      this.editor = new FMM.Editor(this, $('mapCanvas'));
      this.history = new FMM.History(this, 25);
      this.buildStaticUi();
      this.bindUi();
      this.editor.setTool('pan');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.savePending) this.autosave();
      });
      window.addEventListener('beforeunload', (e) => {
        if (!this.savePending) return;
        this.autosave();
        e.preventDefault();
        e.returnValue = '';
      });

      // Schriften laden und danach neu zeichnen
      if (document.fonts && document.fonts.load) {
        Promise.all([
          document.fonts.load('600 20px "Cinzel"'),
          document.fonts.load('16px "IM Fell English"'),
          document.fonts.load('italic 16px "IM Fell English"'),
        ]).then(() => this.editor.requestDraw()).catch(() => {});
      }

      let loaded = false;
      try {
        const last = await FMM.Store.lastId();
        if (last) {
          this.setMap(await FMM.Store.load(last));
          loaded = true;
          this.toast('Letzte Karte geladen');
        }
      } catch (e) {
        console.warn('Konnte letzte Karte nicht laden:', e);
      }
      if (!loaded) this.generate({ name: 'Neue Welt', seed: FMM.randomSeed() });
    },

    // ---------- Karte setzen / generieren ----------
    generate(params) {
      this.busy(true, 'Erschaffe Welt …');
      setTimeout(() => {
        try {
          const map = FMM.generateMap(params);
          this.setMap(map);
          this.changed(true);
        } catch (e) {
          console.error(e);
          alert('Fehler bei der Generierung: ' + e.message);
        }
        this.busy(false);
      }, 40);
    },

    setMap(map) {
      // ausstehende Änderungen der bisherigen Karte sofort sichern
      if (this.savePending && this.map && this.map !== map) this.autosave();
      this.map = map;
      if (!map.biomeMap) map.biomeMap = new Uint8Array(map.width * map.height).fill(255);
      map.view = map.view || { style: 'geo' };
      map.view.layers = Object.assign({}, FMM.STYLE_PRESETS[map.view.style] || FMM.STYLE_PRESETS.geo, map.view.layers);
      this.d = FMM.Derive.all(map);
      this.renderer.setMap(map);
      this.citySig = this.citySignature();
      this.renderer.renderBase(map, this.d);
      this.history.reset();
      this.updateUndoButtons();
      this.selection = null;
      this.paintStateId = map.states.length ? map.states[0].id : 0;
      this.editor.fitted = false;
      this.editor.fit();
      this.syncUi();
    },

    // ---------- Nach Änderungen ----------
    afterTerrainEdit(wasWater) {
      const map = this.map, d = this.d;
      FMM.Derive.coastDistance(map, d);
      FMM.Derive.hydrology(map, d);
      if (wasWater) this.assignNewLand(wasWater);
      FMM.Derive.politics(map, d);
      this.renderer.invalidateRivers();
      this.renderer.renderBase(map, d);
      this.editor.requestDraw();
      this.changed();
    },

    // Neu entstandenes Land dem angrenzenden Staat zuweisen
    assignNewLand(wasWater) {
      const map = this.map, W = map.width, H = map.height, N = W * H, h = map.heights, sm = map.stateMap;
      const cand = new Uint8Array(N);
      let any = false;
      for (let i = 0; i < N; i++) if (wasWater[i] && h[i] >= 0) { cand[i] = 1; sm[i] = 0; any = true; }
      if (!any) return;
      const queue = new Int32Array(N);
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (h[i] >= 0 && sm[i] !== 0 && !cand[i]) queue[qt++] = i;
      while (qh < qt) {
        const c = queue[qh++];
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of FMM.N4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (cand[n] === 1) { cand[n] = 2; sm[n] = sm[c]; queue[qt++] = n; }
        }
      }
    },

    afterBiomeEdit() {
      this.renderer.biomeCount = null;
      this.renderer.invalidateSymbols();
      this.editor.requestDraw();
      this.renderBiomeInfo();
      this.changed();
    },

    biomePaintColor() {
      const b = FMM.BIOMES[this.paintBiome];
      return b ? `rgb(${b.color.join(',')})` : '#ffffff';
    },

    onToolChanged(tool) {
      $('biomeCard').hidden = tool !== 'biome';
      if (tool !== 'biome' || !this.map) return;
      this.renderBiomeList();
      if (this.map.view.style !== 'geo') {
        this.map.view.style = 'geo';
        this.map.view.layers = Object.assign({}, FMM.STYLE_PRESETS.geo);
        this.renderer.renderBase(this.map, this.d);
        this.syncUi();
        this.changed();
        this.toast('Landschaftsformen sind in der geografischen Ansicht sichtbar – Ansicht gewechselt');
      }
    },

    renderBiomeList() {
      const list = $('biomeList');
      const items = [{ id: 255, name: 'Automatisch (Radierer)', auto: true }, ...FMM.BIOMES];
      list.innerHTML = items.map((b) => `<li data-id="${b.id}" class="${b.auto ? 'none ' : ''}${b.id === this.paintBiome ? 'active' : ''}">
        <span class="sw" style="${b.auto ? 'background:transparent;border-style:dashed' : `background:rgb(${b.color.join(',')})`}"></span>
        <span class="nm">${esc(b.name)}</span></li>`).join('');
      list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
        this.paintBiome = +li.dataset.id;
        this.renderBiomeList();
        this.editor.requestDraw();
      }));
      this.renderBiomeInfo();
    },

    renderBiomeInfo() {
      if (!this.map || $('biomeCard').hidden) return;
      let n = 0;
      const bm = this.map.biomeMap, h = this.map.heights;
      for (let i = 0; i < bm.length; i++) if (bm[i] !== 255 && h[i] >= 0) n++;
      $('biomeInfo').textContent = n ? `Von Hand gemalt: ${this.km2(n)}` : 'Noch nichts von Hand gemalt – alles wird automatisch aus Klima und Gelände bestimmt.';
      $('btnClearBiomes').disabled = !n;
    },

    afterStateEdit() {
      FMM.Derive.politics(this.map, this.d);
      this.renderer.invalidateBorders();
      this.renderer.renderBase(this.map, this.d);
      this.editor.requestDraw();
      this.changed();
    },

    afterRestore(terrainChanged) {
      const map = this.map, d = this.d;
      if (terrainChanged) {
        FMM.Derive.coastDistance(map, d);
        FMM.Derive.hydrology(map, d);
        this.renderer.invalidateRivers();
      }
      this.renderer.invalidateBorders();
      this.renderer.invalidateRoads();
      d.latT = FMM.Derive.latitudeTemps(map);
      FMM.Derive.politics(map, d);
      this.renderer.renderBase(map, d);
      if (this.selection && !this.findSelected()) this.selection = null;
      this.editor.requestDraw();
      this.syncUi();
      this.changed();
    },

    changed(immediate) {
      // Städte verändert (neu, verschoben, gelöscht, Typ)? → Straßennetz neu berechnen
      const sig = this.citySignature();
      if (sig !== this.citySig) {
        this.renderer.invalidateRoads();
        this.citySig = sig;
        this.editor.requestDraw();
      }
      $('status').textContent = 'Ungespeicherte Änderungen …';
      this.savePending = true;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.autosave(), immediate ? 200 : 1500);
      clearTimeout(this.uiTimer);
      this.uiTimer = setTimeout(() => { this.renderStateList(); this.renderMapInfo(); }, 150);
    },

    citySignature() {
      return this.map ? this.map.cities.map((c) => c.id + c.type + Math.round(c.x) + ',' + Math.round(c.y)).join('|') : '';
    },

    async autosave() {
      if (!this.map) return;
      clearTimeout(this.saveTimer);
      this.savePending = false;
      try {
        const thumb = this.renderer.exportCanvas(this.map, this.d, 320 / this.map.width).toDataURL('image/jpeg', 0.75);
        await FMM.Store.save(this.map, thumb);
        const t = new Date();
        $('status').textContent = 'Im Browser gespeichert · ' + t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        console.warn(e);
        $('status').textContent = 'Automatisches Speichern fehlgeschlagen – bitte „Datei speichern“ nutzen';
      }
    },

    // ---------- Auswahl ----------
    findSelected() {
      const s = this.selection;
      if (!s) return null;
      if (s.type === 'city') return this.map.cities.find((c) => c.id === s.id);
      if (s.type === 'label') return this.map.labels.find((l) => l.id === s.id);
      if (s.type === 'state') return this.map.states.find((st) => st.id === s.id);
      return null;
    },

    select(sel) {
      this.selection = sel;
      if (sel && sel.type === 'state') { this.paintStateId = sel.id; this.renderStateList(); }
      this.renderSelection();
      this.editor.requestDraw();
    },

    moveSelected(hit, x, y) {
      const map = this.map;
      x = FMM.clamp(x, 0, map.width); y = FMM.clamp(y, 0, map.height);
      if (hit.type === 'city') { const c = map.cities.find((o) => o.id === hit.id); if (c) { c.x = x; c.y = y; } }
      else if (hit.type === 'label') { const l = map.labels.find((o) => o.id === hit.id); if (l) { l.x = x; l.y = y; } }
      else if (hit.type === 'state') { const s = map.states.find((o) => o.id === hit.id); if (s) { s.labelX = x; s.labelY = y; } }
    },

    deleteSelection() {
      const s = this.selection;
      if (!s) return;
      const map = this.map;
      if (s.type === 'city') {
        this.history.push();
        map.cities = map.cities.filter((c) => c.id !== s.id);
        for (const st of map.states) if (st.capital === s.id) st.capital = null;
      } else if (s.type === 'label') {
        this.history.push();
        map.labels = map.labels.filter((l) => l.id !== s.id);
      } else return;
      this.select(null);
      this.changed();
    },

    nameGen() {
      const used = [...this.map.cities.map((c) => c.name), ...this.map.states.map((s) => s.name)];
      return new FMM.NameGen(FMM.makeRng(Math.random()), used);
    },

    stateAt(x, y) {
      const map = this.map;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) return null;
      const i = iy * map.width + ix;
      if (map.heights[i] < 0) return null;
      return map.states.find((s) => s.id === map.stateMap[i]) || null;
    },

    addCity(x, y) {
      const map = this.map;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) return;
      if (map.heights[iy * map.width + ix] < 0) { this.toast('Städte können nur auf Land gesetzt werden'); return; }
      this.history.push();
      const st = this.stateAt(x, y);
      const culture = st ? st.culture : FMM.makeRng(Math.random()).pick(Object.keys(FMM.CULTURES));
      let type = this.newCityType;
      if (type === 'capital' && (!st || st.capital)) type = 'city';
      const city = { id: FMM.uid(), x, y, name: this.nameGen().name(culture), type };
      if (type === 'capital' && st) st.capital = city.id;
      map.cities.push(city);
      this.select({ type: 'city', id: city.id });
      this.changed();
    },

    addLabel(x, y) {
      this.history.push();
      const lb = { id: FMM.uid(), x, y, text: 'Neuer Text', kind: 'custom', size: 16, angle: 0 };
      this.map.labels.push(lb);
      this.select({ type: 'label', id: lb.id });
      this.changed();
      // nach dem Mausklick fokussieren, sonst nimmt der Browser den Fokus wieder weg
      setTimeout(() => {
        const inp = $('selText');
        if (inp) { inp.focus(); inp.select(); }
      }, 0);
    },

    addState() {
      const map = this.map;
      this.history.push();
      const id = map.states.reduce((m, s) => Math.max(m, s.id), 0) + 1;
      const gen = this.nameGen();
      const culture = gen.rng.pick(Object.keys(FMM.CULTURES));
      map.states.push({ id, name: gen.name(culture), form: gen.stateForm(culture), color: FMM.stateColor(id - 1, gen.rng), culture, capital: null });
      this.paintStateId = id;
      this.editor.setTool('state');
      FMM.Derive.politics(map, this.d);
      this.renderStateList();
      this.renderStateEditor();
      this.changed();
      this.toast('Neuer Staat angelegt – male jetzt sein Gebiet auf die Karte');
    },

    deleteState(id) {
      const map = this.map;
      const st = map.states.find((s) => s.id === id);
      if (!st || !confirm(`„${st.form} ${st.name}“ wirklich auflösen? Das Gebiet wird herrenlos.`)) return;
      this.history.push();
      this.history.newVersion('state');
      for (let i = 0; i < map.stateMap.length; i++) if (map.stateMap[i] === id) map.stateMap[i] = 0;
      const cap = map.cities.find((c) => c.id === st.capital);
      if (cap) cap.type = 'city';
      map.states = map.states.filter((s) => s.id !== id);
      this.paintStateId = map.states.length ? map.states[0].id : 0;
      if (this.selection && this.selection.type === 'state' && this.selection.id === id) this.select(null);
      this.afterStateEdit();
      this.renderStateList();
    },

    paintColor() {
      const s = this.map && this.map.states.find((o) => o.id === this.paintStateId);
      return s ? s.color : '#ffffff';
    },

    setBrushSize(v) {
      v = FMM.clamp(Math.round(v), 2, 120);
      this.editor.brush.size = v;
      $('brushSize').value = v;
      $('brushSizeOut').textContent = v;
      this.editor.requestDraw();
    },

    // ---------- Dateien ----------
    async saveFile() {
      if (!this.map) return;
      const blob = await FMM.mapToBlob(this.map);
      FMM.downloadBlob(blob, FMM.safeFilename(this.map.name) + '.fmap');
      this.toast('Karte als Datei gespeichert');
    },

    async openFile(file) {
      this.busy(true, 'Lade Karte …');
      try {
        const map = await FMM.mapFromFile(file);
        this.setMap(map);
        this.changed(true);
        this.toast('„' + map.name + '“ geöffnet');
      } catch (e) {
        console.error(e);
        alert('Die Datei konnte nicht geöffnet werden: ' + e.message);
      }
      this.busy(false);
    },

    exportPng(factor) {
      this.busy(true, 'Exportiere Bild …');
      setTimeout(() => {
        try {
          const c = this.renderer.exportCanvas(this.map, this.d, factor);
          c.toBlob((blob) => {
            this.busy(false);
            if (!blob) { alert('Export fehlgeschlagen (Bild zu groß?)'); return; }
            FMM.downloadBlob(blob, FMM.safeFilename(this.map.name) + '.png');
          }, 'image/png');
        } catch (e) {
          this.busy(false);
          alert('Export fehlgeschlagen: ' + e.message);
        }
      }, 40);
    },

    // ---------- UI-Helfer ----------
    busy(on, text) {
      $('busy').hidden = !on;
      if (text) $('busyText').textContent = text;
    },

    toast(msg) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
    },

    updateUndoButtons() {
      $('btnUndo').disabled = !this.history.undoStack.length;
      $('btnRedo').disabled = !this.history.redoStack.length;
    },

    showCoords(x, y) {
      const map = this.map;
      if (!map) return;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) { $('coords').textContent = ''; return; }
      const i = iy * map.width + ix;
      const h = map.heights[i];
      let txt;
      if (h < 0) txt = 'Meer · Tiefe ' + Math.round(-h * 8000).toLocaleString('de-DE') + ' m';
      else if (this.d.lake[i]) txt = 'See';
      else {
        txt = 'Höhe ' + Math.round(h * 6000).toLocaleString('de-DE') + ' m';
        const b = FMM.BIOMES[this.renderer.biome[i]];
        if (b && this.map.view.style === 'geo') txt += ' · ' + b.name + (this.map.biomeMap[i] !== 255 ? ' (gemalt)' : '');
      }
      const st = this.stateAt(x, y);
      if (st) txt += ' · ' + st.form + ' ' + st.name;
      $('coords').textContent = txt;
    },

    km2(cells) {
      const k = this.map.settings.kmPerPixel || 4;
      return Math.round(cells * k * k).toLocaleString('de-DE') + ' km²';
    },

    // Feld mit Rückgängig-Unterstützung verbinden (ein Verlaufseintrag pro Bearbeitung)
    bindField(el, apply, evt) {
      let pending = true;
      el.addEventListener('focus', () => { pending = true; });
      el.addEventListener(evt || 'input', () => {
        if (pending) { this.history.push(); pending = false; }
        apply(el.type === 'checkbox' ? el.checked : el.value);
        this.editor.requestDraw();
        this.changed();
      });
      el.addEventListener('change', () => { pending = true; });
    },

    // ---------- Statische UI ----------
    buildStaticUi() {
      const fill = (sel, obj, labelKey) => {
        sel.innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(labelKey ? v[labelKey] : v)}</option>`).join('');
      };
      fill($('sizeSelect'), FMM.MAP_SIZES, 'label');
      $('sizeSelect').value = 'mittel';
      fill($('landTypeSelect'), FMM.LAND_TYPES, 'label');
      fill($('newClimate'), FMM.CLIMATES, 'label');
      fill($('newWind'), FMM.WINDS);
      fill($('windSelect'), FMM.WINDS);
      fill($('climateSelect'), FMM.CLIMATES, 'label');
      const cultures = { gemischt: 'Gemischt (nach Klima)' };
      for (const [k, v] of Object.entries(FMM.CULTURES)) cultures[k] = v.label;
      fill($('cultureSelect'), cultures);
    },

    bindUi() {
      // Werkzeuge
      document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => this.editor.setTool(b.dataset.tool)));
      $('brushSize').addEventListener('input', (e) => this.setBrushSize(+e.target.value));
      $('brushStrength').addEventListener('input', (e) => {
        this.editor.brush.strength = e.target.value / 100;
        $('brushStrengthOut').textContent = e.target.value;
      });
      $('zoomIn').onclick = () => this.editor.zoomAt(this.editor.cssW / 2, this.editor.cssH / 2, 1.3);
      $('zoomOut').onclick = () => this.editor.zoomAt(this.editor.cssW / 2, this.editor.cssH / 2, 1 / 1.3);
      $('zoomFit').onclick = () => this.editor.fit();

      // Kopfleiste
      $('btnUndo').onclick = () => this.history.undo();
      $('btnRedo').onclick = () => this.history.redo();
      $('btnSave').onclick = () => this.saveFile();
      $('btnOpen').onclick = () => $('fileInput').click();
      $('fileInput').onchange = (e) => {
        const f = e.target.files[0];
        if (f) this.openFile(f);
        e.target.value = '';
      };
      $('btnExport').onclick = () => $('exportDialog').showModal();
      $('exportDialog').addEventListener('close', () => {
        if ($('exportDialog').returnValue === 'ok') this.exportPng(+$('exportScale').value);
      });
      $('mapName').addEventListener('change', (e) => {
        if (!this.map) return;
        this.map.name = e.target.value.trim() || 'Unbenannte Karte';
        e.target.value = this.map.name;
        document.title = this.map.name + ' – Fantasy Map Maker';
        this.changed();
      });

      // Neue Karte
      const form = $('newForm');
      $('btnNew').onclick = () => {
        $('seedInput').value = FMM.randomSeed();
        $('newDialog').showModal();
      };
      $('btnSeed').onclick = () => { $('seedInput').value = FMM.randomSeed(); };
      form.querySelectorAll('input[type=range]').forEach((r) => {
        const out = r.parentElement.querySelector('output');
        const upd = () => { out.textContent = Math.round(r.value * 100) + ' %'; };
        r.addEventListener('input', upd);
        upd();
      });
      $('newDialog').addEventListener('close', () => {
        if ($('newDialog').returnValue !== 'ok') return;
        const f = new FormData(form);
        const size = FMM.MAP_SIZES[f.get('size')] || FMM.MAP_SIZES.mittel;
        this.generate({
          name: f.get('name') || 'Neue Welt',
          seed: f.get('seed') || FMM.randomSeed(),
          width: size.width,
          height: size.height,
          landType: f.get('landType'),
          landFraction: +f.get('landFraction'),
          mountains: +f.get('mountains'),
          featureScale: +f.get('featureScale'),
          riverDensity: +f.get('riverDensity'),
          erosion: +f.get('erosion'),
          wind: f.get('wind'),
          climate: f.get('climate'),
          culture: f.get('culture'),
          stateCount: +f.get('stateCount'),
          cityCount: +f.get('cityCount'),
          kmPerPixel: Math.round((5000 / size.width) * 10) / 10,
        });
      });

      // Meine Karten
      $('btnMaps').onclick = () => this.openMapsDialog();
      $('btnCloseMaps').onclick = () => $('mapsDialog').close();

      // Darstellung
      document.querySelectorAll('#styleSeg button').forEach((b) => b.addEventListener('click', () => {
        const map = this.map;
        map.view.style = b.dataset.style;
        map.view.layers = Object.assign({}, FMM.STYLE_PRESETS[b.dataset.style]);
        this.renderer.renderBase(map, this.d);
        this.editor.requestDraw();
        this.syncUi();
        this.changed();
      }));
      document.querySelectorAll('#layers input').forEach((cb) => cb.addEventListener('change', () => {
        const k = cb.dataset.layer;
        this.map.view.layers[k] = cb.checked;
        if (BASE_LAYERS.has(k)) this.renderer.renderBase(this.map, this.d);
        this.editor.requestDraw();
        this.changed();
      }));
      let reliefTimer = 0;
      $('reliefStrength').addEventListener('input', (e) => {
        this.map.view.relief = +e.target.value;
        clearTimeout(reliefTimer);
        reliefTimer = setTimeout(() => { this.renderer.renderBase(this.map, this.d); this.editor.requestDraw(); this.changed(); }, 60);
      });

      // Staaten
      $('btnAddState').onclick = () => this.addState();
      $('btnClearBiomes').onclick = () => {
        if (!confirm('Alle von Hand gemalten Landschaftsformen entfernen? (Rückgängig ist möglich)')) return;
        this.history.push();
        this.history.newVersion('biome');
        this.map.biomeMap.fill(255);
        this.renderer.renderBase(this.map, this.d);
        this.afterBiomeEdit();
      };
      $('btnRecalcBorders').onclick = () => {
        if (!confirm('Grenzen anhand der Hauptstädte neu berechnen? Von Hand gemalte Grenzen gehen dabei verloren (Rückgängig ist möglich).')) return;
        this.history.push();
        this.history.newVersion('state');
        FMM.recomputeBorders(this.map, this.d);
        this.afterStateEdit();
      };

      // Karte
      $('climateSelect').addEventListener('change', (e) => {
        this.history.push();
        this.map.settings.climate = e.target.value;
        this.d.latT = FMM.Derive.latitudeTemps(this.map);
        this.renderer.renderBase(this.map, this.d);
        this.editor.requestDraw();
        this.changed();
      });
      $('riverDensity').addEventListener('change', (e) => {
        this.history.push();
        this.map.settings.riverDensity = +e.target.value;
        FMM.Derive.hydrology(this.map, this.d);
        this.renderer.invalidateRivers();
        this.renderer.renderBase(this.map, this.d);
        this.editor.requestDraw();
        this.changed();
      });
      // Wind ändern → Niederschlag (Regenschatten) neu berechnen
      $('windSelect').addEventListener('change', (e) => {
        this.busy(true, 'Berechne Klima …');
        setTimeout(() => {
          this.history.push();
          this.history.newVersion('terrain');
          this.map.settings.wind = e.target.value;
          this.map.moisture = FMM.computeMoisture(this.map);
          this.afterTerrainEdit(null);
          this.busy(false);
          this.toast('Niederschlag für ' + FMM.WINDS[e.target.value] + ' neu berechnet');
        }, 30);
      });
      $('btnErode').addEventListener('click', () => {
        this.busy(true, 'Erosion läuft …');
        setTimeout(() => {
          this.history.push();
          this.history.newVersion('terrain');
          const wasWater = this.editor.waterMask();
          FMM.erode(this.map.heights, this.map.width, this.map.height, 0.4, FMM.makeRng(Math.random()));
          this.afterTerrainEdit(wasWater);
          this.busy(false);
          this.toast('Erosion angewendet – mehrfach klicken verstärkt den Effekt');
        }, 30);
      });
      $('kmPerPixel').addEventListener('change', (e) => {
        const v = +e.target.value;
        if (!(v > 0)) return;
        this.history.push();
        this.map.settings.kmPerPixel = v;
        this.editor.requestDraw();
        this.changed();
      });
    },

    // ---------- UI synchronisieren ----------
    syncUi() {
      const map = this.map;
      $('mapName').value = map.name;
      document.title = map.name + ' – Fantasy Map Maker';
      document.querySelectorAll('#styleSeg button').forEach((b) => b.classList.toggle('active', b.dataset.style === map.view.style));
      document.querySelectorAll('#layers input').forEach((cb) => { cb.checked = !!map.view.layers[cb.dataset.layer]; });
      $('reliefStrength').value = map.view.relief || 1;
      $('climateSelect').value = map.settings.climate || 'gemaessigt';
      $('riverDensity').value = map.settings.riverDensity || 1;
      $('kmPerPixel').value = map.settings.kmPerPixel || 4;
      $('windSelect').value = map.settings.wind || 'auto';
      this.renderStateList();
      this.renderSelection();
      this.renderMapInfo();
      if (this.editor.tool === 'biome') this.renderBiomeList();
    },

    renderMapInfo() {
      const map = this.map;
      let land = 0;
      for (let i = 0; i < map.heights.length; i++) if (map.heights[i] >= 0) land++;
      $('mapInfo').innerHTML = [
        `Seed: <b>${esc(map.settings.seed || '–')}</b>`,
        `Größe: ${map.width} × ${map.height} px`,
        `Landfläche: ${this.km2(land)} (${Math.round((land / map.heights.length) * 100)} %)`,
        `${map.states.length} Staaten · ${map.cities.length} Städte · ${this.d.rivers.length} Flüsse`,
      ].join('<br>');
    },

    renderStateList() {
      const map = this.map;
      const info = this.d.stateInfo || {};
      const list = $('stateList');
      const states = map.states.slice().sort((a, b) => (info[b.id] ? info[b.id].area : 0) - (info[a.id] ? info[a.id].area : 0));
      $('stateCount').textContent = map.states.length;
      list.innerHTML =
        `<li data-id="0" class="none ${this.paintStateId === 0 ? 'active' : ''}"><span class="sw" style="background:transparent;border-style:dashed"></span><span class="nm">Herrenlos (Radierer)</span></li>` +
        states.map((s) => `<li data-id="${s.id}" class="${s.id === this.paintStateId ? 'active' : ''}">
          <span class="sw" style="background:${esc(s.color)}"></span>
          <span class="nm" title="${esc(s.form + ' ' + s.name)}">${esc(s.name)}</span>
          <span class="ar">${info[s.id] ? this.km2(info[s.id].area) : ''}</span></li>`).join('');
      list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
        this.paintStateId = +li.dataset.id;
        this.renderStateList();
        if (this.editor.tool !== 'state' && !this.editor.pointer) this.toast('Tipp: Mit „Staat malen“ kannst du Gebiete zuweisen');
        this.editor.requestDraw();
      }));
      this.renderStateEditor();
    },

    renderStateEditor() {
      const box = $('stateEditor');
      const st = this.map.states.find((s) => s.id === this.paintStateId);
      if (!st) { box.innerHTML = ''; return; }
      const forms = FMM.ALL_FORMS.includes(st.form) ? FMM.ALL_FORMS : [st.form, ...FMM.ALL_FORMS];
      const caps = this.map.cities.filter((c) => {
        const s = this.stateAt(c.x, c.y);
        return (s && s.id === st.id) || c.id === st.capital;
      });
      box.innerHTML = `<div class="form-grid">
        <span>Name</span><span class="inline"><input id="stName" value="${esc(st.name)}"><button id="stDice" title="Neuer Zufallsname">🎲</button></span>
        <span>Staatsform</span><select id="stForm">${forms.map((f) => `<option ${f === st.form ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <span>Farbe</span><input id="stColor" type="color" value="${esc(st.color)}">
        <span>Kultur</span><select id="stCulture">${Object.entries(FMM.CULTURES).map(([k, v]) => `<option value="${k}" ${k === st.culture ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <span>Hauptstadt</span><select id="stCapital"><option value="">– keine –</option>${caps.map((c) => `<option value="${c.id}" ${c.id === st.capital ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="btn-row"><button id="stPaint">🖌️ Gebiet malen</button><button id="stDelete" class="danger">🗑 Auflösen</button></div>`;
      this.bindField($('stName'), (v) => { st.name = v; });
      $('stName').addEventListener('change', () => this.renderStateList());
      this.bindField($('stForm'), (v) => { st.form = v; }, 'change');
      this.bindField($('stCulture'), (v) => { st.culture = v; }, 'change');
      this.bindField($('stColor'), (v) => {
        st.color = v;
        clearTimeout(this.colorTimer);
        this.colorTimer = setTimeout(() => { this.renderer.renderBase(this.map, this.d); this.editor.requestDraw(); }, 50);
      });
      $('stColor').addEventListener('change', () => this.renderStateList());
      $('stCapital').addEventListener('change', (e) => {
        this.history.push();
        const old = this.map.cities.find((c) => c.id === st.capital);
        if (old) old.type = 'city';
        st.capital = e.target.value || null;
        const nc = this.map.cities.find((c) => c.id === st.capital);
        if (nc) {
          // war die Stadt Hauptstadt eines anderen Staates?
          for (const o of this.map.states) if (o !== st && o.capital === nc.id) o.capital = null;
          nc.type = 'capital';
        }
        this.editor.requestDraw();
        this.renderSelection();
        this.changed();
      });
      $('stDice').onclick = () => {
        this.history.push();
        st.name = this.nameGen().name(st.culture);
        this.renderStateList();
        this.editor.requestDraw();
        this.changed();
      };
      $('stPaint').onclick = () => this.editor.setTool('state');
      $('stDelete').onclick = () => this.deleteState(st.id);
    },

    renderSelection() {
      const card = $('selectionCard');
      const obj = this.findSelected();
      if (!obj) { card.hidden = true; return; }
      card.hidden = false;
      const body = $('selBody');
      const s = this.selection;
      if (s.type === 'city') {
        const st = this.stateAt(obj.x, obj.y);
        $('selTitle').textContent = 'Stadt';
        body.innerHTML = `<div class="form-grid">
          <span>Name</span><span class="inline"><input id="selName" value="${esc(obj.name)}"><button id="selDice" title="Neuer Zufallsname">🎲</button></span>
          <span>Typ</span><select id="selType">${Object.entries(CITY_TYPES).map(([k, v]) => `<option value="${k}" ${k === obj.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <span>Staat</span><span>${st ? esc(st.form + ' ' + st.name) : '<i>herrenlos</i>'}</span>
        </div>
        <div class="btn-row"><button id="selDelete" class="danger">🗑 Löschen</button></div>`;
        this.bindField($('selName'), (v) => { obj.name = v; });
        $('selType').addEventListener('change', (e) => {
          this.history.push();
          const t = e.target.value;
          if (t === 'capital') {
            if (!st) { this.toast('Herrenlose Städte können keine Hauptstadt sein'); e.target.value = obj.type; return; }
            const old = this.map.cities.find((c) => c.id === st.capital && c.id !== obj.id);
            if (old) old.type = 'city';
            st.capital = obj.id;
          } else {
            for (const o of this.map.states) if (o.capital === obj.id) o.capital = null;
          }
          obj.type = t;
          this.newCityType = t === 'capital' ? 'city' : t;
          this.editor.requestDraw();
          this.renderStateEditor();
          this.changed();
        });
        $('selDice').onclick = () => {
          this.history.push();
          obj.name = this.nameGen().name(st ? st.culture : 'germanisch');
          $('selName').value = obj.name;
          this.editor.requestDraw();
          this.changed();
        };
      } else if (s.type === 'label') {
        $('selTitle').textContent = obj.kind === 'sea' ? 'Meeresname' : 'Beschriftung';
        body.innerHTML = `<div class="form-grid">
          <span>Text</span><input id="selText" value="${esc(obj.text)}">
          <span>Stil</span><select id="selKind">
            <option value="custom" ${obj.kind === 'custom' && obj.font !== 'text' ? 'selected' : ''}>Titel (Kapitälchen)</option>
            <option value="text" ${obj.font === 'text' && obj.kind !== 'sea' ? 'selected' : ''}>Handschrift</option>
            <option value="sea" ${obj.kind === 'sea' ? 'selected' : ''}>Gewässer (kursiv)</option>
          </select>
          <span>Größe</span><input id="selSize" type="range" min="6" max="72" value="${obj.size || 16}">
          <span>Drehung</span><input id="selAngle" type="range" min="-90" max="90" value="${Math.round(((obj.angle || 0) * 180) / Math.PI)}">
          <span>Farbe</span><span class="inline"><input id="selColor" type="color" value="${esc(obj.color || '#2a221c')}"><button id="selColorReset" title="Standardfarbe">Standard</button></span>
        </div>
        <div class="btn-row"><button id="selDelete" class="danger">🗑 Löschen</button></div>`;
        this.bindField($('selText'), (v) => { obj.text = v; });
        this.bindField($('selSize'), (v) => { obj.size = +v; });
        this.bindField($('selAngle'), (v) => { obj.angle = (+v * Math.PI) / 180; });
        this.bindField($('selColor'), (v) => { obj.color = v; });
        $('selColorReset').onclick = () => { this.history.push(); delete obj.color; this.editor.requestDraw(); this.changed(); };
        $('selKind').addEventListener('change', (e) => {
          this.history.push();
          const v = e.target.value;
          obj.kind = v === 'sea' ? 'sea' : 'custom';
          obj.font = v === 'text' ? 'text' : undefined;
          $('selTitle').textContent = obj.kind === 'sea' ? 'Meeresname' : 'Beschriftung';
          this.editor.requestDraw();
          this.changed();
        });
      } else if (s.type === 'state') {
        const info = this.d.stateInfo[obj.id];
        $('selTitle').textContent = 'Staatsname';
        const auto = obj.labelSize == null;
        body.innerHTML = `<div class="form-grid">
          <span>Staat</span><span>${esc(obj.form + ' ' + obj.name)}</span>
          <span>Größe</span><span class="inline"><input id="selSize" type="range" min="5" max="60" value="${obj.labelSize || 18}" ${auto ? 'disabled' : ''}><label><input id="selAuto" type="checkbox" ${auto ? 'checked' : ''}> auto</label></span>
          <span>Drehung</span><input id="selAngle" type="range" min="-90" max="90" value="${Math.round(((obj.labelAngle != null ? obj.labelAngle : info ? info.angle : 0) * 180) / Math.PI)}">
        </div>
        <div class="btn-row"><button id="selReset">↺ Automatisch platzieren</button></div>`;
        this.bindField($('selSize'), (v) => { obj.labelSize = +v; });
        this.bindField($('selAngle'), (v) => { obj.labelAngle = (+v * Math.PI) / 180; });
        $('selAuto').addEventListener('change', (e) => {
          this.history.push();
          if (e.target.checked) delete obj.labelSize; else obj.labelSize = +$('selSize').value;
          $('selSize').disabled = e.target.checked;
          this.editor.requestDraw();
          this.changed();
        });
        $('selReset').onclick = () => {
          this.history.push();
          delete obj.labelX; delete obj.labelY; delete obj.labelSize; delete obj.labelAngle;
          this.renderSelection();
          this.editor.requestDraw();
          this.changed();
        };
      }
      const del = $('selDelete');
      if (del) del.onclick = () => this.deleteSelection();
    },

    async openMapsDialog() {
      const grid = $('mapGrid');
      grid.innerHTML = '<div class="empty">Lade …</div>';
      $('mapsDialog').showModal();
      let maps = [];
      try { maps = await FMM.Store.list(); } catch (e) { grid.innerHTML = '<div class="empty">Browser-Speicher nicht verfügbar.</div>'; return; }
      if (!maps.length) { grid.innerHTML = '<div class="empty">Noch keine Karten gespeichert.</div>'; return; }
      grid.innerHTML = maps.map((m) => `<div class="map-item ${this.map && m.id === this.map.id ? 'current' : ''}" data-id="${esc(m.id)}">
        ${m.thumbnail ? `<img src="${m.thumbnail}" alt="">` : '<img alt="">'}
        <div class="meta"><b>${esc(m.name)}</b><small>${new Date(m.updated).toLocaleString('de-DE')} · ${m.width}×${m.height}</small></div>
        <div class="acts"><button data-act="open" class="primary">Öffnen</button><button data-act="del" class="danger">Löschen</button></div>
      </div>`).join('');
      grid.querySelectorAll('.map-item').forEach((el) => {
        const id = el.dataset.id;
        el.querySelector('[data-act=open]').onclick = async () => {
          $('mapsDialog').close();
          if (this.map && id === this.map.id) return;
          await this.autosave();
          this.busy(true, 'Lade Karte …');
          try { this.setMap(await FMM.Store.load(id)); this.changed(true); } catch (e) { alert(e.message); }
          this.busy(false);
        };
        el.querySelector('[data-act=del]').onclick = async () => {
          const name = el.querySelector('b').textContent;
          if (!confirm(`„${name}“ endgültig aus dem Browser löschen?`)) return;
          await FMM.Store.remove(id);
          el.remove();
          if (this.map && id === this.map.id) this.toast('Die geöffnete Karte bleibt offen und wird bei der nächsten Änderung wieder gespeichert');
        };
      });
    },
  };

  FMM.app = app;
  window.addEventListener('DOMContentLoaded', () => app.init());
})();
