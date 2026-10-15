/* Kartensymbole im Stil klassischer Fantasy-Karten: gezeichnete Berge, Hügel und Bäume */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Symbole aus Gelände und Landschaftsformen ableiten
  FMM.buildSymbols = function (map, d, renderer) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const veg = renderer.veg, fine = renderer.fine;
    const g = Math.max(5, Math.round(8 * unit)); // Rasterabstand in Zellen
    const out = [];
    // Städte freihalten
    const cityNear = (x, y) => map.cities.some((c) => Math.abs(c.x - x) < 7 * unit && Math.abs(c.y - y) < 5 * unit);

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
          const t = FMM.cellTemp(d.latT[y], v);
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
  };

  const PALETTE = {
    geo: { ink: 'rgba(40,36,30,0.85)', light: 'rgba(236,230,214,0.9)', shade: 'rgba(80,70,58,0.55)', tree: '#355a2c', tree2: '#5d7d3a', ground: 'rgba(40,36,30,0.6)' },
    political: { ink: 'rgba(58,50,44,0.85)', light: 'rgba(250,246,236,0.92)', shade: 'rgba(110,96,80,0.45)', tree: '#6f8a58', tree2: '#8ea468', ground: 'rgba(58,50,44,0.6)' },
    antique: { ink: '#3f2c18', light: '#efe2bf', shade: 'rgba(90,62,30,0.5)', tree: '#7c7f4c', tree2: '#99945c', ground: 'rgba(63,44,24,0.7)' },
  };

  FMM.drawSymbols = function (ctx, symbols, style, unit) {
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
