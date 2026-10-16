/* Kartensymbole im Stil klassischer Fantasy-Karten: gezeichnete Berge, Hügel und Bäume */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Symbole aus Gelände und Landschaftsformen ableiten
  FMM.buildSymbols = function (map, d, renderer) {
    const style = map.view.style;
    const free = freeMask(map, d, renderer);
    const out = style === 'fantasy' ? buildFantasy(map, d, renderer, free) : buildClassic(map, d, renderer, free);
    out.style = style;
    out.settle = !!map.view.layers.settlements;
    return out;
  };

  // Flächen, die frei von Gelände-Symbolen bleiben: Städte, Orte, Dörfer, Bauwerke, Mauern
  function freeMask(map, d, renderer) {
    const W = map.width, H = map.height;
    const unit = Math.min(W, H) / 750;
    const free = new Uint8Array(W * H);
    const box = (x0, y0, x1, y1) => {
      x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(W - 1, Math.ceil(x1));
      y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H - 1, Math.ceil(y1));
      for (let yy = y0; yy <= y1; yy++) free.fill(1, yy * W + x0, yy * W + x1 + 1);
    };
    for (const c of map.cities) box(c.x - 6 * unit, c.y - 4 * unit, c.x + 6 * unit, c.y + 4 * unit);
    for (const p of map.pois || []) box(p.x - 7 * unit, p.y - 12 * unit, p.x + 7 * unit, p.y + 6 * unit);
    if (map.view.layers.settlements && renderer.ensureDecor) {
      const dec = renderer.ensureDecor(map, d);
      for (const o of dec.settle) box(o.x - o.s * 1.3, o.y - o.s * 2.3, o.x + o.s * 1.3, o.y + o.s * 0.8);
      for (const w of map.walls || []) for (let k = 0; k < w.pts.length; k += 2) box(w.pts[k] - 2.5 * unit, w.pts[k + 1] - 3.5 * unit, w.pts[k] + 2.5 * unit, w.pts[k + 1] + 2.5 * unit);
    }
    return free;
  }

  function buildClassic(map, d, renderer, free) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const veg = renderer.veg, fine = renderer.fine;
    const g = Math.max(5, Math.round(8 * unit)); // Rasterabstand in Zellen
    const out = [];
    // Städte, Orte und Bauwerke freihalten
    const cityNear = (x, y) => free[(y | 0) * W + (x | 0)] === 1;

    // 1. Durchgang: Berge auf eigenem, weiterem Raster – größer, nur auf hohen Graten
    const gm = Math.max(7, Math.round(11 * unit));
    const peaks = [];
    for (let gy = gm; gy < H - gm; gy += gm) {
      for (let gx = gm; gx < W - gm; gx += gm) {
        const x = gx + Math.floor((FMM.hash2(gx + 5, gy) - 0.5) * gm * 0.8);
        const y = gy + Math.floor((FMM.hash2(gy + 2, gx + 9) - 0.5) * gm * 0.8);
        const i = y * W + x;
        const v = h[i];
        if (v < 0.5 || d.lake[i] || d.curv[i] < -0.004 || cityNear(x, y)) continue;
        const rr = FMM.hash2(x + 3, y * 5);
        if (rr < 0.3 && v < 0.65) continue; // Lücken, damit kein gleichmäßiges Raster entsteht
        const s = (4.5 + (v - 0.5) * 16) * unit * (0.8 + rr * 0.45);
        peaks.push({ x: x + 0.5, y: y + 0.5, s });
        out.push({ t: 'berg', x: x + 0.5, y: y + 0.5, s, r: FMM.hash2(x, y) });
      }
    }
    const nearPeak = (x, y) => peaks.some((p) => Math.abs(p.x - x) < p.s * 1.3 && y > p.y - p.s * 1.8 && y < p.y + p.s * 0.6);

    for (let gy = g; gy < H - g; gy += g) {
      for (let gx = g; gx < W - g; gx += g) {
        // zufällig versetzter Abtastpunkt im Rasterfeld
        const x = gx + Math.floor((FMM.hash2(gx, gy) - 0.5) * g * 0.9);
        const y = gy + Math.floor((FMM.hash2(gy + 11, gx + 3) - 0.5) * g * 0.9);
        const i = y * W + x;
        const v = h[i];
        if (v < 0.01 || d.lake[i]) continue;
        if (v >= 0.5 || cityNear(x, y) || nearPeak(x, y)) continue;
        const rnd = FMM.hash2(x * 7 + 1, y * 13 + 2);

        if (v > 0.28 && rnd < 0.5) {
          out.push({ t: 'huegel', x: x + 0.5, y: y + 0.5, s: (2.4 + (v - 0.26) * 6) * unit, r: rnd });
          continue;
        }

        // Landschaftsform an dieser Stelle (gemalte Übermalung hat Vorrang)
        let bi = map.biomeMap[i];
        if (bi === 255) {
          const t = FMM.cellTemp(d.latT[y], v, d.tempA[i]);
          const slope = Math.hypot(Math.max(0, h[i + 1]) - Math.max(0, h[i - 1]), Math.max(0, h[i + W]) - Math.max(0, h[i - W])) * 40 * (W / 1200);
          bi = FMM.classifyBiome(t, map.moisture[i], v, slope, d.riverDist[i], veg[i], fine[i]);
        }
        if (bi === BI.taiga || bi === BI.wald || bi === BI.regenwald) {
          // kleine Baumgruppe
          const kind = bi === BI.taiga ? 'nadel' : bi === BI.regenwald ? 'tropen' : 'laub';
          const n = 1 + Math.floor(rnd * 2);
          for (let k = 0; k < n; k++) {
            const ox = (FMM.hash2(x + k * 5, y - k) - 0.5) * g * 0.8;
            const oy = (FMM.hash2(y + k * 3, x + k) - 0.5) * g * 0.6;
            out.push({ t: kind, x: x + 0.5 + ox, y: y + 0.5 + oy, s: (1.7 + rnd * 0.6) * unit, r: FMM.hash2(k, x + y) });
          }
        }
      }
    }
    // von hinten nach vorn zeichnen, damit untere Symbole obere überdecken
    out.sort((a, b) => a.y - b.y);
    const res = { style: map.view.style, list: out, ground: buildGround(map, d, renderer, free, null) };
    return res;
  }

  // ---------- Bodensymbole: Dünen, Schilf, Gras, Akazien, Palmen, Tundra, Gletscherspalten ----------
  function buildGround(map, d, renderer, free, busy) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const veg = renderer.veg, fine = renderer.fine;
    const hash = FMM.hash2;
    const out = [];
    const g = Math.max(3, Math.round(6 * unit));
    for (let gy = g; gy < H - g; gy += g) {
      const row = (gy / g) | 0;
      for (let gx = g + (row % 2 ? g >> 1 : 0); gx < W - g; gx += g) {
        const x = gx + ((hash(gx + 31, gy) - 0.5) * g * 0.9) | 0;
        const y = gy + ((hash(gy + 17, gx + 5) - 0.5) * g * 0.9) | 0;
        const i = y * W + x, v = h[i];
        if (v < 0.003 || d.lake[i] || free[i] || (busy && busy[i]) || d.riverDist[i] < 1) continue;
        let bi = map.biomeMap[i];
        if (bi === 255) {
          const slope = Math.hypot(Math.max(0, h[i + 1]) - Math.max(0, h[i - 1]), Math.max(0, h[i + W]) - Math.max(0, h[i - W])) * 40 * (W / 1200);
          bi = FMM.classifyBiome(FMM.cellTemp(d.latT[y], v, d.tempA[i]), map.moisture[i], v, slope, d.riverDist[i], veg[i], fine[i]);
        }
        const r = hash(x * 7 + 3, y * 11 + 1);
        const t = FMM.cellTemp(d.latT[y], v, d.tempA[i]);
        const px = x + 0.5, py = y + 0.5;
        // Palmen an tropischen Küsten und in Oasen
        if (t > 0.68 && v < 0.08 && ((d.coastDist[i] <= 4 && bi !== BI.wueste) || (bi === BI.wueste && d.riverDist[i] < 3))) {
          if (r < 0.55) out.push({ t: 'palme', x: px, y: py, s: (1.7 + r) * unit, r });
          continue;
        }
        if (bi === BI.wueste) { if (r < 0.42) out.push({ t: 'duene', x: px, y: py, s: (2.2 + r * 1.2) * unit, r }); }
        else if (bi === BI.sumpf) { if (r < 0.62) out.push({ t: 'schilf', x: px, y: py, s: (1.4 + r * 0.4) * unit, r }); }
        else if (bi === BI.steppe) { if (r < 0.32) out.push({ t: 'gras', x: px, y: py, s: 1.3 * unit, r }); }
        else if (bi === BI.savanne) {
          if (r < 0.16) out.push({ t: 'akazie', x: px, y: py, s: (1.5 + r * 2) * unit, r });
          else if (r < 0.4) out.push({ t: 'gras', x: px, y: py, s: 1.3 * unit, r });
        } else if (bi === BI.tundra) { if (r < 0.3) out.push({ t: 'tuff', x: px, y: py, s: 1.2 * unit, r }); }
        else if (bi === BI.gletscher) { if (r < 0.32) out.push({ t: 'spalte', x: px, y: py, s: (1.4 + r) * unit, r }); }
      }
    }
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  const GROUND = {
    fantasy: { ink: 'rgba(70,52,34,0.75)', grass: 'rgba(110,122,62,0.85)', dune: 'rgba(150,104,56,0.85)', duneShade: 'rgba(176,124,70,0.35)', reed: 'rgba(78,96,52,0.9)', canopy: '#7d9646', palm: '#4f7d38', trunk: '#6a4a2c', tuff: 'rgba(120,120,90,0.8)', crack: 'rgba(110,140,172,0.8)' },
    antique: { ink: 'rgba(63,44,24,0.8)', grass: 'rgba(63,44,24,0.6)', dune: 'rgba(63,44,24,0.75)', duneShade: 'rgba(90,62,30,0.25)', reed: 'rgba(63,44,24,0.75)', canopy: '#9a945c', palm: '#7c7f4c', trunk: '#5a3e22', tuff: 'rgba(63,44,24,0.55)', crack: 'rgba(63,44,24,0.5)' },
    geo: { ink: 'rgba(40,36,30,0.7)', grass: 'rgba(70,80,40,0.6)', dune: 'rgba(120,90,50,0.6)', duneShade: 'rgba(120,90,50,0.2)', reed: 'rgba(50,64,40,0.7)', canopy: '#5d7d3a', palm: '#3f6a2e', trunk: '#5a4430', tuff: 'rgba(70,70,50,0.55)', crack: 'rgba(110,140,170,0.7)' },
    political: { ink: 'rgba(58,50,44,0.7)', grass: 'rgba(90,100,60,0.55)', dune: 'rgba(130,100,64,0.6)', duneShade: 'rgba(130,100,64,0.18)', reed: 'rgba(70,84,56,0.65)', canopy: '#8ea468', palm: '#6f8a58', trunk: '#6a5440', tuff: 'rgba(90,90,70,0.5)', crack: 'rgba(120,150,180,0.6)' },
  };

  function drawGround(ctx, list, style, unit) {
    const P = GROUND[style] || GROUND.fantasy;
    const B = {};
    const pa = (k) => B[k] || (B[k] = new Path2D());
    for (const o of list) {
      const { x, y, s, r } = o;
      if (o.t === 'duene') {
        const d = r > 0.5 ? 1 : -1; // Leeseite links oder rechts
        const sh = pa('duneShade');
        sh.moveTo(x - s * d, y); sh.quadraticCurveTo(x - s * 0.15 * d, y - s * 0.75, x + s * 0.9 * d, y - s * 0.12);
        sh.quadraticCurveTo(x + s * 0.3 * d, y + s * 0.1, x - s * d, y);
        const cr = pa('dune');
        cr.moveTo(x - s * d, y); cr.quadraticCurveTo(x - s * 0.15 * d, y - s * 0.75, x + s * 0.9 * d, y - s * 0.12);
        cr.moveTo(x - s * 0.3 * d, y + s * 0.45); cr.quadraticCurveTo(x + s * 0.2 * d, y + s * 0.15, x + s * 0.6 * d, y + s * 0.4);
      } else if (o.t === 'schilf') {
        const w = pa('water'), p = pa('reed');
        w.moveTo(x - s * 1.1, y + s * 0.2); w.lineTo(x - s * 0.45, y + s * 0.2); w.moveTo(x + s * 0.35, y + s * 0.2); w.lineTo(x + s * 0.9, y + s * 0.2);
        p.moveTo(x, y); p.lineTo(x - s * 0.45, y - s * 0.85);
        p.moveTo(x, y); p.lineTo(x, y - s * 1.15);
        p.moveTo(x, y); p.lineTo(x + s * 0.4, y - s * 0.8);
        p.moveTo(x - s * 0.25, y); p.lineTo(x - s * 0.15, y - s * 0.5);
        const c = pa('cattail');
        c.moveTo(x + s * 0.06, y - s * 1.0); c.lineTo(x + s * 0.06, y - s * 1.35);
      } else if (o.t === 'gras') {
        const p = pa('grass');
        p.moveTo(x - s * 0.15, y); p.lineTo(x - s * 0.5, y - s * 0.65);
        p.moveTo(x, y); p.lineTo(x + s * 0.02, y - s * 0.85);
        p.moveTo(x + s * 0.15, y); p.lineTo(x + s * 0.5, y - s * 0.6);
      } else if (o.t === 'akazie') {
        const t = pa('trunk');
        t.moveTo(x, y); t.lineTo(x, y - s * 0.65); t.lineTo(x - s * 0.35, y - s * 1.05); t.moveTo(x, y - s * 0.65); t.lineTo(x + s * 0.3, y - s * 1.05);
        const c = pa('canopy');
        c.moveTo(x + s * 0.95, y - s * 1.12); c.ellipse(x, y - s * 1.12, s * 0.95, s * 0.26, 0, 0, Math.PI * 2);
      } else if (o.t === 'palme') {
        const t = pa('trunk'), f = pa('palm');
        const lean = (r - 0.5) * 0.6;
        const tx = x + s * lean, ty = y - s * 1.45;
        t.moveTo(x, y); t.quadraticCurveTo(x + s * lean * 0.2, y - s * 0.8, tx, ty);
        for (const [ax, ay] of [[-0.9, 0.35], [-0.6, -0.1], [0.05, -0.35], [0.65, -0.1], [0.95, 0.35]]) {
          f.moveTo(tx, ty); f.quadraticCurveTo(tx + ax * s * 0.55, ty + (ay - 0.35) * s * 0.6, tx + ax * s * 0.75, ty + ay * s * 0.75);
        }
      } else if (o.t === 'tuff') {
        const p = pa('tuff');
        p.moveTo(x - s * 0.5, y - s * 0.3); p.quadraticCurveTo(x - s * 0.25, y, x, y - s * 0.35);
        p.moveTo(x, y - s * 0.35); p.quadraticCurveTo(x + s * 0.25, y, x + s * 0.5, y - s * 0.3);
      } else if (o.t === 'spalte') {
        const p = pa('crack');
        p.moveTo(x - s, y - s * 0.1); p.quadraticCurveTo(x - s * 0.3, y - s * 0.45, x + s * 0.2, y - s * 0.1); p.quadraticCurveTo(x + s * 0.55, y + s * 0.1, x + s, y - s * 0.2);
      }
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (B.duneShade) { ctx.fillStyle = P.duneShade; ctx.fill(B.duneShade); }
    const st = (k, col, w) => { if (B[k]) { ctx.strokeStyle = col; ctx.lineWidth = w * unit; ctx.stroke(B[k]); } };
    st('dune', P.dune, 0.45);
    st('water', P.crack, 0.35);
    st('reed', P.reed, 0.35);
    st('cattail', P.trunk, 0.6);
    st('grass', P.grass, 0.32);
    st('tuff', P.tuff, 0.3);
    st('crack', P.crack, 0.38);
    st('trunk', P.trunk, 0.4);
    if (B.canopy) { ctx.fillStyle = P.canopy; ctx.fill(B.canopy); ctx.strokeStyle = P.ink; ctx.lineWidth = 0.3 * unit; ctx.stroke(B.canopy); }
    st('palm', P.palm, 0.55);
    ctx.restore();
  }

  // ---------- Fantasy-Stil: Gebirgsketten und dichte Waldflächen wie auf gemalten Fantasy-Karten ----------
  function buildFantasy(map, d, renderer, free) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const biome = renderer.biome;
    const busy = new Uint8Array(W * H); // von Bergen/Hügeln belegte Zellen → dort keine Bäume
    const cityNear = (x, y) => free[(y | 0) * W + (x | 0)] === 1;
    const mark = (x, y, s, up) => {
      const x0 = Math.max(0, Math.floor(x - s)), x1 = Math.min(W - 1, Math.ceil(x + s));
      const y0 = Math.max(0, Math.floor(y - s * up)), y1 = Math.min(H - 1, Math.ceil(y + s * 0.3));
      for (let yy = y0; yy <= y1; yy++) busy.fill(1, yy * W + x0, yy * W + x1 + 1);
    };
    const relief = [];

    // Gipfel: dichtes, versetztes Raster entlang der Grate – überlappend, damit Ketten entstehen
    const gm = Math.max(5, Math.round(8 * unit));
    for (let gy = gm; gy < H - gm; gy += gm) {
      const row = (gy / gm) | 0;
      for (let gx = gm + (row % 2 ? gm >> 1 : 0); gx < W - gm; gx += gm) {
        const x = gx + Math.floor((FMM.hash2(gx + 5, gy) - 0.5) * gm * 0.7);
        const y = gy + Math.floor((FMM.hash2(gy + 2, gx + 9) - 0.5) * gm * 0.7);
        const i = y * W + x;
        const v = h[i];
        if (v < 0.42 || d.lake[i] || cityNear(x, y)) continue;
        const rr = FMM.hash2(x + 3, y * 5);
        // Täler zwischen den Graten freilassen, im Hochgebirge dichter
        if (d.curv[i] < -0.006 && rr < 0.8) continue;
        if (v < 0.52 && rr < 0.45) continue;
        const s = (4.6 + (v - 0.42) * 16) * unit * (0.8 + rr * 0.4);
        const snowLine = FMM.clamp(0.58 + (d.latT[y] + d.tempA[i] - 0.3) * 0.7, 0.36, 0.95);
        const snow = FMM.clamp((v - snowLine + 0.06) / 0.14, 0, 1);
        relief.push({ t: 'gipfel', x: x + 0.5, y: y + 0.5, s, r: FMM.hash2(x, y), r2: FMM.hash2(y + 7, x), snow });
        mark(x, y, s, 1.6);
      }
    }
    // Hügelland
    const gh = Math.max(4, Math.round(7 * unit));
    for (let gy = gh; gy < H - gh; gy += gh) {
      for (let gx = gh; gx < W - gh; gx += gh) {
        const x = gx + Math.floor((FMM.hash2(gx + 1, gy + 4) - 0.5) * gh * 0.8);
        const y = gy + Math.floor((FMM.hash2(gy + 6, gx + 2) - 0.5) * gh * 0.8);
        const i = y * W + x;
        const v = h[i];
        if (v < 0.26 || v >= 0.42 || busy[i] || d.lake[i] || cityNear(x, y)) continue;
        const rr = FMM.hash2(x * 3 + 1, y + 8);
        if (rr < 0.8) continue;
        const s = (2.6 + (v - 0.26) * 9) * unit;
        relief.push({ t: 'huegel', x: x + 0.5, y: y + 0.5, s, r: rr });
        mark(x, y, s, 0.9);
      }
    }
    relief.sort((a, b) => a.y - b.y);

    // Wald: feines Raster, jede Abtastung eine Baumkrone
    const gt = Math.max(2, 2.3 * unit);
    const trees = [];
    for (let fy = gt; fy < H - gt; fy += gt) {
      for (let fx = gt; fx < W - gt; fx += gt) {
        const ix = fx | 0, iy = fy | 0;
        const x = fx + (FMM.hash2(ix, iy + 17) - 0.5) * gt * 0.9;
        const y = fy + (FMM.hash2(iy + 3, ix + 29) - 0.5) * gt * 0.9;
        const i = (y | 0) * W + (x | 0);
        const bi = biome[i];
        if (bi !== BI.wald && bi !== BI.taiga && bi !== BI.regenwald) continue;
        if (h[i] < 0.004 || busy[i] || d.lake[i] || d.riverDist[i] < 1.3 || cityNear(x, y)) continue;
        const rnd = FMM.hash2(ix * 7 + 1, iy * 13 + 2);
        trees.push({ t: bi === BI.taiga ? 'nadel' : bi === BI.regenwald ? 'tropen' : 'laub', x, y, s: (1.15 + rnd * 0.35) * unit, r: rnd });
      }
    }
    trees.sort((a, b) => a.y - b.y);
    return { style: 'fantasy', relief, forest: batchTrees(trees), ground: buildGround(map, d, renderer, free, busy) };
  }

  // Baumkronen in wenige Sammelpfade bündeln (zehntausende Symbole bleiben schnell)
  function batchTrees(trees) {
    const P = () => new Path2D();
    const b = { shadow: P(), fill: { laub: [P(), P()], nadel: [P(), P()], tropen: [P(), P()] } };
    for (const o of trees) {
      const { x, y, s, r } = o;
      const f = b.fill[o.t][r > 0.5 ? 1 : 0];
      if (o.t === 'nadel') {
        const tri = (pa, dx, dy) => { pa.moveTo(x + dx, y - s * 1.9 + dy); pa.lineTo(x + s * 0.72 + dx, y + dy); pa.lineTo(x - s * 0.72 + dx, y + dy); pa.closePath(); };
        tri(b.shadow, s * 0.3, s * 0.2);
        tri(f, 0, 0);
      } else {
        const rr = s * (o.t === 'tropen' ? 0.95 : 0.82), cy = y - s * 0.6;
        b.shadow.moveTo(x + rr + s * 0.3, cy + s * 0.25); b.shadow.arc(x + s * 0.3, cy + s * 0.25, rr, 0, Math.PI * 2);
        f.moveTo(x + rr, cy); f.arc(x, cy, rr, 0, Math.PI * 2);
      }
    }
    return b;
  }

  function drawFantasy(ctx, sym, unit) {
    drawGround(ctx, sym.ground, 'fantasy', unit);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Wald
    const F = sym.forest;
    ctx.fillStyle = 'rgba(24,42,22,0.45)';
    ctx.fill(F.shadow);
    const cols = { laub: ['#56803c', '#64904a'], nadel: ['#3f6444', '#4b724c'], tropen: ['#3f7c38', '#4c8c3e'] };
    for (const k of ['laub', 'nadel', 'tropen']) {
      ctx.fillStyle = cols[k][0]; ctx.fill(F.fill[k][0]);
      ctx.fillStyle = cols[k][1]; ctx.fill(F.fill[k][1]);
    }
    // Kontur über alle Kronen: die Überschneidungen ergeben die getupfte Waldstruktur
    ctx.strokeStyle = 'rgba(30,48,26,0.55)';
    ctx.lineWidth = 0.32 * unit;
    for (const k of ['laub', 'nadel', 'tropen']) { ctx.stroke(F.fill[k][0]); ctx.stroke(F.fill[k][1]); }

    // Gebirge und Hügel (von hinten nach vorn)
    const ink = 'rgba(58,46,34,0.9)', light = '#d9cba8', shade = 'rgba(140,124,102,0.95)', hatch = 'rgba(70,58,44,0.55)';
    for (const o of sym.relief) {
      const { x, y, s, r } = o;
      if (o.t === 'huegel') {
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x - s * 0.1, y - s * 1.05, x + s, y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(214,202,160,0.9)'; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x - s * 0.1, y - s * 1.05, x + s, y);
        ctx.strokeStyle = ink; ctx.lineWidth = 0.45 * unit; ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k < 3; k++) { const hx = x + s * (0.2 + k * 0.22); ctx.moveTo(hx, y - s * (0.42 - k * 0.12)); ctx.lineTo(hx + s * 0.12, y - s * 0.05); }
        ctx.strokeStyle = hatch; ctx.lineWidth = 0.35 * unit; ctx.stroke();
        continue;
      }
      // Gipfel mit Nebenspitzen
      const hgt = s * (1.0 + r * 0.4);
      const px = x + (r - 0.5) * s * 0.3, py = y - hgt;
      const L1x = x - s * 0.62, L1y = y - hgt * (0.4 + o.r2 * 0.15);
      const L2x = x - s * 0.38, L2y = y - hgt * 0.36;
      const R1x = x + s * 0.42, R1y = y - hgt * 0.5;
      const R2x = x + s * 0.62, R2y = y - hgt * (o.r2 > 0.45 ? 0.52 : 0.4);
      const outline = () => {
        ctx.moveTo(x - s, y); ctx.lineTo(L1x, L1y); ctx.lineTo(L2x, L2y); ctx.lineTo(px, py);
        ctx.lineTo(R1x, R1y); ctx.lineTo(R2x, R2y); ctx.lineTo(x + s, y);
      };
      ctx.beginPath(); outline(); ctx.closePath();
      ctx.fillStyle = light; ctx.fill();
      // Schattenseite
      const bx = x + s * 0.08;
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(R1x, R1y); ctx.lineTo(R2x, R2y); ctx.lineTo(x + s, y); ctx.lineTo(bx, y);
      ctx.quadraticCurveTo(px + s * 0.12, y - hgt * 0.45, px, py);
      ctx.fillStyle = shade; ctx.fill();
      // Schraffur auf der Schattenseite
      ctx.beginPath();
      const n = 3 + Math.round(s / unit * 0.5);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const ax = px + (bx - px) * t, ay = py + (y - py) * t;
        ctx.moveTo(ax, ay); ctx.lineTo(ax + s * 0.45 * (1 - t * 0.4), ay + hgt * 0.16);
      }
      ctx.strokeStyle = hatch; ctx.lineWidth = 0.3 * unit; ctx.stroke();
      // Schneekappe
      if (o.snow > 0.05) {
        const f = 0.28 + o.snow * 0.3;
        const lx = px + (L2x - px) * f * 1.6, ly = py + (L2y - py) * f * 1.6;
        const rx = px + (R1x - px) * f * 1.8, ry = py + (R1y - py) * f * 1.8;
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(lx, ly);
        ctx.lineTo(px - s * 0.12, py + hgt * f * 0.85); ctx.lineTo(px + s * 0.02, py + hgt * f * 0.6);
        ctx.lineTo(px + s * 0.14, py + hgt * f * 0.95); ctx.lineTo(rx, ry); ctx.closePath();
        ctx.fillStyle = 'rgba(252,252,250,0.95)'; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(rx, ry); ctx.lineTo(px + s * 0.14, py + hgt * f * 0.95); ctx.lineTo(px + s * 0.05, py + hgt * f * 0.5); ctx.closePath();
        ctx.fillStyle = 'rgba(196,208,222,0.9)'; ctx.fill();
      }
      // Umriss und Gratlinie
      ctx.beginPath(); outline();
      ctx.moveTo(px, py); ctx.quadraticCurveTo(px + s * 0.12, y - hgt * 0.45, bx, y - hgt * 0.05);
      ctx.strokeStyle = ink; ctx.lineWidth = 0.5 * unit; ctx.stroke();
    }
    ctx.restore();
  }

  const PALETTE = {
    geo: { ink: 'rgba(40,36,30,0.85)', light: 'rgba(236,230,214,0.9)', shade: 'rgba(80,70,58,0.55)', tree: '#355a2c', tree2: '#5d7d3a', ground: 'rgba(40,36,30,0.6)' },
    political: { ink: 'rgba(58,50,44,0.85)', light: 'rgba(250,246,236,0.92)', shade: 'rgba(110,96,80,0.45)', tree: '#6f8a58', tree2: '#8ea468', ground: 'rgba(58,50,44,0.6)' },
    antique: { ink: '#3f2c18', light: '#efe2bf', shade: 'rgba(90,62,30,0.5)', tree: '#7c7f4c', tree2: '#99945c', ground: 'rgba(63,44,24,0.7)' },
  };

  FMM.drawSymbols = function (ctx, symbols, style, unit) {
    if (symbols.style === 'fantasy') return drawFantasy(ctx, symbols, unit);
    drawGround(ctx, symbols.ground, style, unit);
    const P = PALETTE[style] || PALETTE.antique;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.55 * unit;
    for (const o of symbols.list) {
      const { x, y, s, r } = o;
      ctx.strokeStyle = P.ink;
      if (o.t === 'berg') {
        const px = x + (r - 0.5) * s * 0.3, py = y - s * (1.15 + r * 0.35);
        // Körper
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.lineTo(px, py); ctx.lineTo(x + s, y); ctx.closePath();
        ctx.fillStyle = P.light; ctx.fill();
        // Schattenseite
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.15, y); ctx.closePath();
        ctx.fillStyle = P.shade; ctx.fill();
        // Umriss (ohne Grundlinie) und Grat-Strich
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.lineTo(px, py); ctx.lineTo(x + s, y);
        ctx.moveTo(px, py); ctx.lineTo(px + s * 0.1, py + s * 0.45);
        ctx.stroke();
      } else if (o.t === 'huegel') {
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.quadraticCurveTo(x, y - s * 1.1, x + s, y);
        ctx.fillStyle = P.light; ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + s * 0.15, y - s * 0.4); ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.3, x + s * 0.7, y - s * 0.05);
        ctx.strokeStyle = P.shade; ctx.stroke();
      } else if (o.t === 'nadel') {
        ctx.beginPath();
        ctx.moveTo(x, y - s * 2.2); ctx.lineTo(x + s * 0.75, y); ctx.lineTo(x - s * 0.75, y); ctx.closePath();
        ctx.fillStyle = r > 0.5 ? P.tree : P.tree2; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s * 0.45); ctx.stroke();
      } else if (o.t === 'laub' || o.t === 'tropen') {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.9); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x, y - s * 1.3, s * (o.t === 'tropen' ? 0.95 : 0.8), s * 0.75, 0, 0, Math.PI * 2);
        ctx.fillStyle = r > 0.5 ? P.tree : P.tree2; ctx.fill(); ctx.stroke();
      } else if (o.t === 'sumpf') {
        ctx.strokeStyle = P.ground;
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
        for (const dx of [-0.5, 0, 0.5]) { ctx.moveTo(x + dx * s, y); ctx.lineTo(x + dx * s * 1.3, y - s * (0.7 + Math.abs(dx) * 0.2)); }
        ctx.stroke();
      } else if (o.t === 'duene') {
        ctx.strokeStyle = P.ground;
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x - s * 0.3, y - s * 0.6, x + s * 0.2, y - s * 0.1);
        ctx.moveTo(x - s * 0.2, y + s * 0.5); ctx.quadraticCurveTo(x + s * 0.4, y, x + s, y + s * 0.4);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
})();
