/* Kartensymbole im Stil klassischer Fantasy-Karten: gezeichnete Berge, Hügel und Bäume */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Symbole aus Gelände und Landschaftsformen ableiten
  FMM.buildSymbols = function (map, d, renderer) {
    const style = map.view.style;
    if (style === 'fantasy') return buildFantasy(map, d, renderer);
    const out = buildClassic(map, d, renderer);
    out.style = style;
    return out;
  };

  function buildClassic(map, d, renderer) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const veg = renderer.veg, fine = renderer.fine;
    const g = Math.max(5, Math.round(8 * unit)); // Rasterabstand in Zellen
    const out = [];
    // Städte freihalten
    const cityNear = (x, y) => map.cities.some((c) => Math.abs(c.x - x) < 7 * unit && Math.abs(c.y - y) < 5 * unit) ||
      (map.pois || []).some((p) => Math.abs(p.x - x) < 7 * unit && y > p.y - 12 * unit && y < p.y + 6 * unit);

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
        } else if (bi === BI.sumpf && rnd < 0.6) {
          out.push({ t: 'sumpf', x: x + 0.5, y: y + 0.5, s: 2 * unit, r: rnd });
        } else if (bi === BI.wueste && rnd < 0.35) {
          out.push({ t: 'duene', x: x + 0.5, y: y + 0.5, s: 2.6 * unit, r: rnd });
        }
      }
    }
    // von hinten nach vorn zeichnen, damit untere Symbole obere überdecken
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  // ---------- Fantasy-Stil: Gebirgsketten und dichte Waldflächen wie auf gemalten Fantasy-Karten ----------
  function buildFantasy(map, d, renderer) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const biome = renderer.biome;
    const busy = new Uint8Array(W * H); // von Bergen/Hügeln belegte Zellen → dort keine Bäume
    // Städte freihalten (Maske statt Suche je Symbol)
    const free = new Uint8Array(W * H);
    for (const c of map.cities) {
      const x0 = Math.max(0, Math.floor(c.x - 6 * unit)), x1 = Math.min(W - 1, Math.ceil(c.x + 6 * unit));
      const y0 = Math.max(0, Math.floor(c.y - 4 * unit)), y1 = Math.min(H - 1, Math.ceil(c.y + 4 * unit));
      for (let yy = y0; yy <= y1; yy++) free.fill(1, yy * W + x0, yy * W + x1 + 1);
    }
    for (const p of map.pois || []) {
      const x0 = Math.max(0, Math.floor(p.x - 7 * unit)), x1 = Math.min(W - 1, Math.ceil(p.x + 7 * unit));
      const y0 = Math.max(0, Math.floor(p.y - 12 * unit)), y1 = Math.min(H - 1, Math.ceil(p.y + 6 * unit));
      for (let yy = y0; yy <= y1; yy++) free.fill(1, yy * W + x0, yy * W + x1 + 1);
    }
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
    return { style: 'fantasy', relief, forest: batchTrees(trees) };
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
    const P = PALETTE[style] || PALETTE.antique;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.55 * unit;
    for (const o of symbols) {
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
