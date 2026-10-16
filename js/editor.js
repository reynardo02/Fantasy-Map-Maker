/* Editor: Ansicht (Zoom/Verschieben), Werkzeuge, Pinsel, Auswahl, Rückgängig */
(function () {
  'use strict';
  const FMM = window.FMM;

  const TERRAIN_TOOLS = new Set(['raise', 'lower', 'smooth', 'flatten', 'land', 'sea', 'mountain']);
  const BRUSH_TOOLS = new Set([...TERRAIN_TOOLS, 'state', 'biome']);

  const HINTS = {
    pan: 'Ziehen zum Verschieben · Mausrad zum Zoomen · Klick auf Stadt/Text zum Auswählen',
    raise: 'Gelände anheben – über die Karte malen',
    lower: 'Gelände absenken – über die Karte malen',
    smooth: 'Gelände glätten – über die Karte malen',
    flatten: 'Auf die Höhe des Startpunkts einebnen',
    land: 'Neues Land aus dem Meer heben',
    sea: 'Land im Meer versinken lassen',
    mountain: 'Zerklüftete Gebirge auftürmen',
    state: 'Gebiet dem gewählten Staat zuweisen (Staat rechts auswählen)',
    biome: 'Landschaftsform malen (rechts auswählen) · „Automatisch“ entfernt Übermalungen',
    city: 'Klick auf freie Fläche: neue Stadt · Klick auf Stadt: auswählen · Ziehen: verschieben',
    label: 'Klick auf freie Fläche: neuer Text · Klick auf Text/Staatsnamen: auswählen · Ziehen: verschieben',
    poi: 'Klick auf freie Fläche: neuer Ort (Typ rechts wählen) · Klick auf Ort: auswählen · Ziehen: verschieben',
  };

  class History {
    constructor(app, limit) {
      this.app = app;
      this.limit = limit || 25;
      this.undoStack = [];
      this.redoStack = [];
      this.counter = 1;
      this.cache = { h: null, s: null, b: null };
    }
    reset() {
      this.undoStack = [];
      this.redoStack = [];
      this.cache = { h: null, s: null, b: null };
      this.app.terrainVersion = ++this.counter;
      this.app.stateVersion = ++this.counter;
      this.app.biomeVersion = ++this.counter;
    }
    snapshot() {
      const app = this.app, map = app.map;
      // unveränderliche Kopien wiederverwenden, solange sich nichts geändert hat
      if (!this.cache.h || this.cache.h.v !== app.terrainVersion) this.cache.h = { v: app.terrainVersion, a: map.heights.slice(), m: map.moisture.slice() };
      if (!this.cache.s || this.cache.s.v !== app.stateVersion) this.cache.s = { v: app.stateVersion, a: map.stateMap.slice() };
      if (!this.cache.b || this.cache.b.v !== app.biomeVersion) this.cache.b = { v: app.biomeVersion, a: map.biomeMap.slice() };
      return {
        tv: app.terrainVersion,
        sv: app.stateVersion,
        heights: this.cache.h.a,
        moisture: this.cache.h.m,
        stateMap: this.cache.s.a,
        bv: app.biomeVersion,
        biomeMap: this.cache.b.a,
        json: JSON.stringify({ states: map.states, cities: map.cities, labels: map.labels, pois: map.pois || [], springs: map.springs || [], subtitle: map.subtitle || '', settings: map.settings }),
      };
    }
    push() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
      this.app.updateUndoButtons();
    }
    newVersion(kind) {
      if (kind === 'terrain') this.app.terrainVersion = ++this.counter;
      else if (kind === 'biome') this.app.biomeVersion = ++this.counter;
      else this.app.stateVersion = ++this.counter;
    }
    restore(snap) {
      const app = this.app, map = app.map;
      const terrainChanged = snap.tv !== app.terrainVersion;
      if (terrainChanged) {
        map.heights = snap.heights.slice();
        map.moisture = snap.moisture.slice();
        app.terrainVersion = snap.tv;
        this.cache.h = { v: snap.tv, a: snap.heights, m: snap.moisture };
      }
      if (snap.sv !== app.stateVersion) { map.stateMap = snap.stateMap.slice(); app.stateVersion = snap.sv; this.cache.s = { v: snap.sv, a: snap.stateMap }; }
      if (snap.bv !== app.biomeVersion) { map.biomeMap = snap.biomeMap.slice(); app.biomeVersion = snap.bv; this.cache.b = { v: snap.bv, a: snap.biomeMap }; }
      const o = JSON.parse(snap.json);
      map.states = o.states; map.cities = o.cities; map.labels = o.labels; map.pois = o.pois || []; map.springs = o.springs || []; map.subtitle = o.subtitle || ''; map.settings = o.settings;
      app.afterRestore(terrainChanged);
    }
    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.snapshot());
      this.restore(this.undoStack.pop());
      this.app.updateUndoButtons();
    }
    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.snapshot());
      this.restore(this.redoStack.pop());
      this.app.updateUndoButtons();
    }
  }

  class Editor {
    constructor(app, canvas) {
      this.app = app;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.view = { scale: 1, ox: 0, oy: 0 };
      this.tool = 'pan';
      this.brush = { size: 20, strength: 0.5 };
      this.pointer = null; // aktuelle Interaktion
      this.mouse = null; // letzte Mausposition (Bildschirm)
      this.spaceDown = false;
      this.dirty = null;
      this.frameReq = 0;
      this.mountainNoise = FMM.createNoise2D(FMM.makeRng('gebirge'));
      this.dpr = window.devicePixelRatio || 1;

      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', (e) => this.onUp(e));
      canvas.addEventListener('pointerleave', () => { this.mouse = null; this.requestDraw(); document.getElementById('coords').textContent = ''; });
      canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', (e) => this.onKey(e, true));
      window.addEventListener('keyup', (e) => this.onKey(e, false));
    }

    resize() {
      const r = this.canvas.parentElement.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
      this.cssW = r.width;
      this.cssH = r.height;
      if (!this.fitted && this.app.map) this.fit();
      this.requestDraw();
    }

    fit() {
      const map = this.app.map;
      if (!map || !this.cssW) return;
      const pad = 20;
      const s = Math.min((this.cssW - pad * 2) / map.width, (this.cssH - pad * 2) / map.height);
      this.view.scale = s;
      this.view.ox = (this.cssW - map.width * s) / 2;
      this.view.oy = (this.cssH - map.height * s) / 2;
      this.fitted = true;
      this.requestDraw();
    }

    zoomAt(sx, sy, factor) {
      const v = this.view;
      const ns = FMM.clamp(v.scale * factor, 0.1, 24);
      const f = ns / v.scale;
      v.ox = sx - (sx - v.ox) * f;
      v.oy = sy - (sy - v.oy) * f;
      v.scale = ns;
      this.requestDraw();
    }

    toMap(sx, sy) {
      return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale };
    }

    eventPos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    }

    setTool(tool) {
      this.tool = tool;
      document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
      document.getElementById('hint').textContent = HINTS[tool] || '';
      if (this.app.onToolChanged) this.app.onToolChanged(tool);
      this.updateCursor();
      this.requestDraw();
    }

    updateCursor() {
      let c = 'default';
      if (this.spaceDown || this.tool === 'pan') c = this.pointer && this.pointer.kind === 'pan' ? 'grabbing' : 'grab';
      else if (BRUSH_TOOLS.has(this.tool)) c = 'none';
      else if (this.tool === 'city' || this.tool === 'label' || this.tool === 'poi') c = 'crosshair';
      this.canvas.style.cursor = c;
    }

    // ---------- Zeichnen ----------
    requestDraw() {
      if (this.frameReq) return;
      this.frameReq = requestAnimationFrame(() => {
        this.frameReq = 0;
        this.flushDirty();
        this.draw();
      });
    }

    markDirty(rect) {
      if (!this.dirty) this.dirty = Object.assign({}, rect);
      else {
        this.dirty.x0 = Math.min(this.dirty.x0, rect.x0);
        this.dirty.y0 = Math.min(this.dirty.y0, rect.y0);
        this.dirty.x1 = Math.max(this.dirty.x1, rect.x1);
        this.dirty.y1 = Math.max(this.dirty.y1, rect.y1);
      }
      this.requestDraw();
    }

    flushDirty() {
      if (!this.dirty) return;
      const app = this.app;
      app.renderer.renderBase(app.map, app.d, this.dirty);
      this.dirty = null;
    }

    draw() {
      const app = this.app;
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!app.map) return;
      const v = this.view, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Schatten unter der Karte
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#000';
      ctx.fillRect(v.ox, v.oy, app.map.width * v.scale, app.map.height * v.scale);
      ctx.restore();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = v.scale < 1 ? 'medium' : 'high';
      ctx.drawImage(app.renderer.base, v.ox, v.oy, app.map.width * v.scale, app.map.height * v.scale);
      app.renderer.drawOverlay(ctx, app.map, app.d, v, { selection: app.selection, dpr });

      // Pinselvorschau
      if (this.mouse && BRUSH_TOOLS.has(this.tool) && !this.spaceDown) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const r = this.brush.size * v.scale;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.arc(this.mouse.sx, this.mouse.sy, r + 1, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = this.tool === 'state' ? (app.paintColor() || '#fff') : this.tool === 'biome' ? app.biomePaintColor() : '#fff';
        ctx.beginPath(); ctx.arc(this.mouse.sx, this.mouse.sy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillRect(this.mouse.sx - 1, this.mouse.sy - 1, 2, 2);
      }
    }

    // ---------- Eingaben ----------
    onWheel(e) {
      e.preventDefault();
      const { sx, sy } = this.eventPos(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this.zoomAt(sx, sy, Math.pow(1.0015, -delta));
    }

    onKey(e, down) {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        if (this.spaceDown !== down) { this.spaceDown = down; this.updateCursor(); this.requestDraw(); }
        return;
      }
      if (!down || typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.app.history.redo(); else this.app.history.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.app.history.redo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.app.saveFile(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.app.selection) { e.preventDefault(); this.app.deleteSelection(); } }
      else if (e.key === 'Escape') this.app.select(null);
      else if (!mod) {
        const keys = { v: 'pan', h: 'raise', t: 'lower', g: 'smooth', e: 'flatten', l: 'land', m: 'sea', b: 'mountain', p: 'state', w: 'biome', c: 'city', x: 'label', o: 'poi' };
        const k = keys[e.key.toLowerCase()];
        if (k) this.setTool(k);
        else if (e.key === '+') this.zoomAt(this.cssW / 2, this.cssH / 2, 1.25);
        else if (e.key === '-') this.zoomAt(this.cssW / 2, this.cssH / 2, 0.8);
        else if (e.key === '0') this.fit();
        else if (e.key === '[') this.app.setBrushSize(this.brush.size - 3);
        else if (e.key === ']') this.app.setBrushSize(this.brush.size + 3);
      }
    }

    onDown(e) {
      if (!this.app.map || this.pointer) return;
      this.canvas.setPointerCapture(e.pointerId);
      const { sx, sy } = this.eventPos(e);
      const m = this.toMap(sx, sy);
      this.mouse = { sx, sy };

      // Verschieben: mittlere/rechte Maustaste, Leertaste oder Bewegen-Werkzeug
      if (e.button === 1 || e.button === 2 || this.spaceDown || this.tool === 'pan') {
        let hit = null;
        if (this.tool === 'pan' && e.button === 0 && !this.spaceDown) hit = this.hitTest(m.x, m.y, ['city', 'poi', 'label', 'state']);
        if (hit) {
          this.app.select(hit);
          this.pointer = { kind: 'drag', hit, start: m, moved: false };
        } else {
          this.pointer = { kind: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy, click: e.button === 0 };
        }
        this.updateCursor();
        return;
      }
      if (e.button !== 0) return;

      if (BRUSH_TOOLS.has(this.tool)) {
        this.app.history.push();
        const isTerrain = TERRAIN_TOOLS.has(this.tool);
        this.app.history.newVersion(isTerrain ? 'terrain' : this.tool === 'biome' ? 'biome' : 'state');
        const i = this.cellIndex(m.x, m.y);
        // veraltete Vektorlinien während des Strichs ausblenden
        this.app.renderer.live = isTerrain ? 'terrain' : this.tool === 'state' ? 'state' : null;
        this.pointer = {
          kind: 'brush',
          terrain: isTerrain,
          last: m,
          flatTarget: i >= 0 ? this.app.map.heights[i] : 0,
          wasWater: isTerrain ? this.waterMask() : null,
        };
        this.dab(m.x, m.y);
        return;
      }

      if (this.tool === 'city') {
        const hit = this.hitTest(m.x, m.y, ['city']);
        if (hit) {
          this.app.select(hit);
          this.pointer = { kind: 'drag', hit, start: m, moved: false };
        } else {
          this.app.addCity(m.x, m.y);
        }
        return;
      }
      if (this.tool === 'poi') {
        const hit = this.hitTest(m.x, m.y, ['poi']);
        if (hit) {
          this.app.select(hit);
          this.pointer = { kind: 'drag', hit, start: m, moved: false };
        } else {
          this.app.addPoi(m.x, m.y);
        }
        return;
      }
      if (this.tool === 'label') {
        const hit = this.hitTest(m.x, m.y, ['label', 'state']);
        if (hit) {
          this.app.select(hit);
          this.pointer = { kind: 'drag', hit, start: m, moved: false };
        } else {
          this.app.addLabel(m.x, m.y);
        }
      }
    }

    onMove(e) {
      const { sx, sy } = this.eventPos(e);
      this.mouse = { sx, sy };
      const m = this.toMap(sx, sy);
      this.app.showCoords(m.x, m.y);
      const p = this.pointer;
      if (!p) { if (BRUSH_TOOLS.has(this.tool)) this.requestDraw(); return; }
      if (p.kind === 'pan') {
        this.view.ox = p.ox + (sx - p.sx);
        this.view.oy = p.oy + (sy - p.sy);
        if (Math.abs(sx - p.sx) + Math.abs(sy - p.sy) > 3) p.click = false;
        this.requestDraw();
      } else if (p.kind === 'brush') {
        // Zwischenpunkte für gleichmäßige Striche
        const dx = m.x - p.last.x, dy = m.y - p.last.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.max(1, this.brush.size * 0.25);
        if (dist >= step) {
          const n = Math.floor(dist / step);
          for (let k = 1; k <= n; k++) this.dab(p.last.x + (dx * k) / n, p.last.y + (dy * k) / n);
          p.last = m;
        }
        this.requestDraw();
      } else if (p.kind === 'drag') {
        if (!p.moved) {
          if (Math.hypot(m.x - p.start.x, m.y - p.start.y) * this.view.scale < 3) return;
          this.app.history.push();
          p.moved = true;
        }
        this.app.moveSelected(p.hit, m.x, m.y);
        this.requestDraw();
      }
    }

    onUp(e) {
      const p = this.pointer;
      this.pointer = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      this.updateCursor();
      if (!p) return;
      if (p.kind === 'pan' && p.click && this.tool === 'pan') this.app.select(null);
      if (p.kind === 'brush') {
        this.app.renderer.live = null;
        this.flushDirty();
        if (p.terrain) this.app.afterTerrainEdit(p.wasWater);
        else if (this.tool === 'biome') this.app.afterBiomeEdit();
        else this.app.afterStateEdit();
      }
      if (p.kind === 'drag' && p.moved) this.app.changed();
    }

    // ---------- Pinsel ----------
    cellIndex(x, y) {
      const map = this.app.map;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) return -1;
      return iy * map.width + ix;
    }

    waterMask() {
      const h = this.app.map.heights;
      const w = new Uint8Array(h.length);
      for (let i = 0; i < h.length; i++) if (h[i] < 0) w[i] = 1;
      return w;
    }

    dab(cx, cy) {
      const app = this.app, map = app.map, W = map.width, H = map.height;
      const r = this.brush.size;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      if (x1 < x0 || y1 < y0) return;
      const h = map.heights;
      const s = this.brush.strength;
      const tool = this.tool;

      if (tool === 'biome') {
        // Rand leicht ausgefranst, damit gemalte Flächen natürlich wirken
        const id = app.paintBiome;
        const bm = map.biomeMap, fine = app.renderer.fine;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            const i = y * W + x;
            const lim = r * (0.82 + fine[i] * 0.18);
            if (dx * dx + dy * dy > lim * lim) continue;
            if (h[i] >= 0) bm[i] = id;
          }
        }
        this.markDirty({ x0: x0 - 2, y0: y0 - 2, x1: x1 + 3, y1: y1 + 3 });
        return;
      }

      if (tool === 'state') {
        const id = app.paintStateId;
        const sm = map.stateMap;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            if (dx * dx + dy * dy > r * r) continue;
            const i = y * W + x;
            if (h[i] >= 0) sm[i] = id;
          }
        }
        this.markDirty({ x0: x0 - 2, y0: y0 - 2, x1: x1 + 3, y1: y1 + 3 });
        return;
      }

      let src = null;
      if (tool === 'smooth') {
        // Quelle kopieren, damit die Glättung nicht "verschmiert"
        src = new Float32Array((x1 - x0 + 3) * (y1 - y0 + 3));
      }
      const sw = x1 - x0 + 3;
      if (src) {
        for (let y = y0 - 1; y <= y1 + 1; y++) {
          for (let x = x0 - 1; x <= x1 + 1; x++) {
            const xx = FMM.clamp(x, 0, W - 1), yy = FMM.clamp(y, 0, H - 1);
            src[(y - y0 + 1) * sw + (x - x0 + 1)] = h[yy * W + xx];
          }
        }
      }

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d2 = (dx * dx + dy * dy) / (r * r);
          if (d2 > 1) continue;
          const f = 0.5 + 0.5 * Math.cos(Math.PI * Math.sqrt(d2)); // weicher Rand
          const i = y * W + x;
          let v = h[i];
          switch (tool) {
            case 'raise': v += 0.02 * s * f; break;
            case 'lower': v -= 0.02 * s * f; break;
            case 'smooth': {
              const k = (y - y0 + 1) * sw + (x - x0 + 1);
              let sum = 0;
              for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) sum += src[k + oy * sw + ox];
              v += (sum / 9 - v) * s * f * 0.8;
              break;
            }
            case 'flatten': v += (this.pointer.flatTarget - v) * s * f * 0.35; break;
            case 'land': {
              const target = 0.03 + 0.04 * Math.max(0, this.mountainNoise(x / 25, y / 25));
              if (v < target) v += (target - v) * Math.min(1, s * f * 1.4);
              break;
            }
            case 'sea': {
              const target = -0.12;
              if (v > target) v += (target - v) * Math.min(1, s * f * 1.2);
              break;
            }
            case 'mountain': {
              const n = 1 - Math.abs(this.mountainNoise(x / 9, y / 9));
              const n2 = 1 - Math.abs(this.mountainNoise(x / 3.5 + 50, y / 3.5));
              const add = 0.035 * s * f * (n * n * 0.8 + n2 * 0.35);
              v = Math.max(v, 0.01) + add;
              break;
            }
          }
          h[i] = FMM.clamp(v, -1, 1);
        }
      }

      // Küstenlinien lokal aktualisieren, damit man das Ergebnis sofort sieht
      const cd = app.d.coastDist;
      for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) {
        for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) {
          const i = y * W + x;
          const w = h[i] < 0;
          let edge = false;
          if (x > 0 && (h[i - 1] < 0) !== w) edge = true;
          else if (x < W - 1 && (h[i + 1] < 0) !== w) edge = true;
          else if (y > 0 && (h[i - W] < 0) !== w) edge = true;
          else if (y < H - 1 && (h[i + W] < 0) !== w) edge = true;
          if (edge) cd[i] = 0;
          else if (cd[i] === 0) cd[i] = 1;
          if (!w) app.d.lake[i] = app.d.lake[i] && h[i] < app.d.filled[i] - 0.004 ? 1 : 0;
        }
      }
      this.markDirty({ x0: x0 - 2, y0: y0 - 2, x1: x1 + 3, y1: y1 + 3 });
    }

    // ---------- Trefferprüfung ----------
    hitTest(mx, my, types) {
      const boxes = this.app.renderer.hitBoxes;
      const pad = 4 / this.view.scale;
      for (let k = boxes.length - 1; k >= 0; k--) {
        const b = boxes[k];
        if (!types.includes(b.type)) continue;
        if (b.r) {
          if (Math.hypot(mx - b.x, my - b.y) <= b.r + pad) return { type: b.type, id: b.id };
          continue;
        }
        let dx = mx - b.x, dy = my - b.y;
        if (b.angle) {
          const c = Math.cos(-b.angle), s = Math.sin(-b.angle);
          const rx = dx * c - dy * s, ry = dx * s + dy * c;
          dx = rx; dy = ry;
        }
        if (Math.abs(dx) <= b.w / 2 + pad && Math.abs(dy) <= b.h / 2 + pad) return { type: b.type, id: b.id };
      }
      return null;
    }
  }

  FMM.Editor = Editor;
  FMM.History = History;
})();
