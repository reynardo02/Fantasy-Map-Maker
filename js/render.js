/* Darstellung: Rasterbild (Gelände, Staaten) + Vektorebene (Flüsse, Städte, Beschriftungen) */
(function () {
  'use strict';
  const FMM = window.FMM;

  // ---------- Biom-Farbtabelle (Temperatur × Feuchtigkeit) ----------
  const T_ANCH = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0];
  const BIOME = [
    // trocken          mittel            feucht
    [[232, 236, 238], [232, 237, 240], [228, 235, 240]], // Eis
    [[170, 164, 140], [146, 148, 124], [124, 134, 112]], // Tundra
    [[166, 158, 114], [104, 120, 82], [60, 86, 58]], // Taiga / Steppe
    [[186, 172, 114], [120, 144, 80], [62, 102, 52]], // gemäßigt
    [[208, 186, 128], [158, 158, 90], [66, 108, 48]], // warm
    [[224, 198, 142], [178, 164, 94], [48, 98, 40]], // heiß
    [[230, 204, 148], [188, 168, 98], [40, 90, 36]], // tropisch
  ];
  const LUT_N = 64;
  const LUT = new Uint8Array(LUT_N * LUT_N * 3);
  (function buildLut() {
    for (let ti = 0; ti < LUT_N; ti++) {
      const t = ti / (LUT_N - 1);
      let a = 0;
      while (a < T_ANCH.length - 2 && t > T_ANCH[a + 1]) a++;
      const ft = FMM.clamp((t - T_ANCH[a]) / (T_ANCH[a + 1] - T_ANCH[a]), 0, 1);
      for (let mi = 0; mi < LUT_N; mi++) {
        const m = mi / (LUT_N - 1);
        const b = m < 0.5 ? 0 : 1;
        const fm = m < 0.5 ? m / 0.5 : (m - 0.5) / 0.5;
        for (let c = 0; c < 3; c++) {
          const v0 = FMM.lerp(BIOME[a][b][c], BIOME[a][b + 1][c], fm);
          const v1 = FMM.lerp(BIOME[a + 1][b][c], BIOME[a + 1][b + 1][c], fm);
          LUT[(ti * LUT_N + mi) * 3 + c] = Math.round(FMM.lerp(v0, v1, ft));
        }
      }
    }
  })();

  // Wasserfarben nach Tiefe
  const OCEAN_STOPS = [
    [0, [104, 170, 192]],
    [0.06, [70, 138, 172]],
    [0.3, [40, 94, 142]],
    [1, [16, 42, 84]],
  ];
  const OCEAN_LUT = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const dpt = i / 255;
    let k = 0;
    while (k < OCEAN_STOPS.length - 2 && dpt > OCEAN_STOPS[k + 1][0]) k++;
    const f = (dpt - OCEAN_STOPS[k][0]) / (OCEAN_STOPS[k + 1][0] - OCEAN_STOPS[k][0]);
    for (let c = 0; c < 3; c++) OCEAN_LUT[i * 3 + c] = Math.round(FMM.lerp(OCEAN_STOPS[k][1][c], OCEAN_STOPS[k + 1][1][c], FMM.clamp(f, 0, 1)));
  }

  const STYLE = {
    geo: { river: '#2c5d86', riverAlpha: 0.95, text: '#1d1a16', halo: 'rgba(255,255,255,0.75)', sea: '#d8ecf5', seaHalo: 'rgba(20,50,80,0.55)', city: '#1d1a16', cityFill: '#ffffff', border: [120, 30, 30] },
    political: { river: '#4a80aa', riverAlpha: 0.9, text: '#2a221c', halo: 'rgba(250,246,236,0.85)', sea: '#356283', seaHalo: 'rgba(235,245,250,0.7)', city: '#2a221c', cityFill: '#ffffff', border: [70, 52, 48] },
    antique: { river: '#4f6878', riverAlpha: 0.9, text: '#3b2a18', halo: 'rgba(236,222,186,0.8)', sea: '#5a4a32', seaHalo: 'rgba(236,222,186,0.6)', city: '#3b2a18', cityFill: '#efe1bd', border: [120, 50, 40] },
  };
  FMM.STYLE = STYLE;

  const FONT_LABEL = '"Cinzel", "Trajan Pro", Georgia, serif';
  const FONT_TEXT = '"IM Fell English", "Palatino Linotype", Georgia, serif';

  class Renderer {
    constructor() {
      this.base = document.createElement('canvas');
      this.bctx = this.base.getContext('2d');
      this.hitBoxes = [];
    }

    setMap(map) {
      this.map = map;
      this.base.width = map.width;
      this.base.height = map.height;
      this.img = this.bctx.createImageData(map.width, map.height);
      // Pergamenttextur (feste Saat, damit sie beim Bearbeiten stabil bleibt)
      const N = map.width * map.height;
      this.paper = new Float32Array(N);
      const noise = FMM.createNoise2D(FMM.makeRng('pergament'));
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          this.paper[y * map.width + x] = FMM.fbm(noise, x / 90, y / 90, 4, 2.2, 0.55);
        }
      }
      this.riverCache = null;
    }

    invalidateRivers() { this.riverCache = null; }

    // ---------- Rasterbild ----------
    renderBase(map, d, rect) {
      const W = map.width, H = map.height;
      const x0 = rect ? Math.max(0, rect.x0 | 0) : 0;
      const y0 = rect ? Math.max(0, rect.y0 | 0) : 0;
      const x1 = rect ? Math.min(W, Math.ceil(rect.x1)) : W;
      const y1 = rect ? Math.min(H, Math.ceil(rect.y1)) : H;
      if (x1 <= x0 || y1 <= y0) return;

      const style = map.view.style;
      const L = map.view.layers;
      const h = map.heights, moist = map.moisture, sm = map.stateMap;
      const lake = d.lake, cd = d.coastDist, bd = d.borderDist, latT = d.latT;
      const paper = this.paper;
      const px = this.img.data;

      const maxId = map.states.reduce((m, s) => Math.max(m, s.id), 0);
      const sr = new Uint8Array(maxId + 1), sg = new Uint8Array(maxId + 1), sb = new Uint8Array(maxId + 1);
      const sValid = new Uint8Array(maxId + 1);
      for (const s of map.states) {
        const c = FMM.hexToRgb(s.color);
        sr[s.id] = c[0]; sg[s.id] = c[1]; sb[s.id] = c[2];
        sValid[s.id] = 1;
      }

      const zLand = 11 * (W / 1200) * (map.view.relief || 1);
      const zSea = 3 * (W / 1200);
      const lx = -0.62, ly = -0.62, lz = 0.48;
      const reliefAmt = L.relief ? (style === 'geo' ? 1 : style === 'political' ? 0.7 : 0.9) : 0;
      const border = STYLE[style].border;
      const sty = style === 'geo' ? 0 : style === 'political' ? 1 : 2;
      const maxShade = sty === 0 ? 1.35 : sty === 1 ? 1.15 : 1.12;

      for (let y = y0; y < y1; y++) {
        const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
        const lt = latT[y];
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          const xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i;
          const iu = yu * W + x, id = yd * W + x;
          const hv = h[i];
          const ocean = hv < 0;
          const isLake = lake[i] === 1;
          let r, g, b;

          // Relief-Schattierung
          let shade = 1;
          if (reliefAmt > 0 && !isLake && (!ocean || style === 'geo')) {
            let dzdx, dzdy, z;
            if (ocean) {
              dzdx = h[xr] - h[xl]; dzdy = h[id] - h[iu]; z = zSea;
            } else {
              dzdx = Math.max(0, h[xr]) - Math.max(0, h[xl]);
              dzdy = Math.max(0, h[id]) - Math.max(0, h[iu]);
              z = zLand;
            }
            const nx = -dzdx * z, ny = -dzdy * z;
            const len = Math.sqrt(nx * nx + ny * ny + 1);
            const dot = (nx * lx + ny * ly + lz) / len;
            shade = 1 + (dot / lz - 1) * reliefAmt * (ocean ? 0.6 : 1);
            if (shade < 0.3) shade = 0.3; else if (shade > maxShade) shade = maxShade;
          }

          if (ocean) {
            const depth = -hv;
            if (sty === 0) {
              const k = Math.min(255, (depth * 255) | 0) * 3;
              r = OCEAN_LUT[k]; g = OCEAN_LUT[k + 1]; b = OCEAN_LUT[k + 2];
              if (cd[i] <= 2) { const f = (3 - cd[i]) * 0.09; r += (170 - r) * f; g += (215 - g) * f; b += (220 - b) * f; }
              if (lt < 0.06) { const f = FMM.smoothstep(0.06, -0.04, lt) * 0.85; r += (226 - r) * f; g += (236 - g) * f; b += (242 - b) * f; }
            } else if (sty === 1) {
              r = 170 - depth * 40; g = 205 - depth * 35; b = 224 - depth * 20;
              const c = cd[i];
              if (c === 3 || c === 8 || c === 15) { r -= 26; g -= 20; b -= 12; }
            } else {
              const pp = paper[i] * 10;
              r = 205 + pp - depth * 25; g = 192 + pp - depth * 25; b = 158 + pp - depth * 22;
              const c = cd[i];
              if (c === 3 || c === 7 || c === 12) { r -= 34; g -= 34; b -= 30; }
            }
            shade = 1 + (shade - 1) * 0.5;
          } else if (isLake) {
            if (sty === 0) { r = 72; g = 128; b = 160; }
            else if (sty === 1) { r = 150; g = 192; b = 214; }
            else { r = 180; g = 170; b = 140; }
          } else {
            const t = FMM.cellTemp(lt, hv);
            if (sty === 0) {
              const ti = Math.max(0, Math.min(LUT_N - 1, (t * (LUT_N - 1)) | 0));
              const mi = Math.max(0, Math.min(LUT_N - 1, (moist[i] * (LUT_N - 1)) | 0));
              const k = (ti * LUT_N + mi) * 3;
              r = LUT[k]; g = LUT[k + 1]; b = LUT[k + 2];
              // Fels im Hochgebirge
              const rock = FMM.smoothstep(0.42, 0.8, hv);
              if (rock > 0) { r += (132 - r) * rock; g += (120 - g) * rock; b += (104 - b) * rock; }
              // Schnee
              const snow = FMM.smoothstep(0.11, 0.03, t);
              if (snow > 0) { r += (246 - r) * snow; g += (248 - g) * snow; b += (250 - b) * snow; }
              // Strand
              if (hv < 0.012 && cd[i] <= 1 && t > 0.3) { r = (r + 214) / 2; g = (g + 200) / 2; b = (b + 160) / 2; }
            } else if (sty === 1) {
              r = 240; g = 232; b = 208;
              const hi = FMM.smoothstep(0.35, 0.8, hv);
              r -= hi * 25; g -= hi * 28; b -= hi * 30;
            } else {
              const pp = paper[i] * 14;
              r = 226 + pp; g = 206 + pp; b = 160 + pp;
              const hi = FMM.smoothstep(0.3, 0.85, hv);
              r -= hi * 40; g -= hi * 46; b -= hi * 50;
            }
          }

          r *= shade; g *= shade; b *= shade;

          // Staaten
          if (!ocean) {
            const s = sm[i];
            if (L.stateFill && s && sValid[s]) {
              let a = sty === 1 ? 0.42 : 0.28;
              const dist = bd[i];
              if (dist < 4) a += (4 - dist) * 0.07;
              if (isLake) a *= 0.25;
              r += (sr[s] - r) * a; g += (sg[s] - g) * a; b += (sb[s] - b) * a;
            }
            if (L.borders && !isLake) {
              let edge = false;
              if (x < W - 1 && h[i + 1] >= 0 && sm[i + 1] !== s) edge = true;
              else if (x > 0 && h[i - 1] >= 0 && sm[i - 1] !== s) edge = true;
              else if (y < H - 1 && h[i + W] >= 0 && sm[i + W] !== s) edge = true;
              else if (y > 0 && h[i - W] >= 0 && sm[i - W] !== s) edge = true;
              if (edge) {
                const a = sty === 0 ? 0.6 : 0.8;
                r += (border[0] - r) * a; g += (border[1] - g) * a; b += (border[2] - b) * a;
              }
            }
            // Küstenlinie
            if (cd[i] === 0) {
              const f = sty === 0 ? 0.82 : 0.45;
              r *= f; g *= f; b *= f;
            }
          }

          // feines Korn
          const grain = (FMM.hash2(x, y) - 0.5) * (sty === 0 ? 6 : 8);
          const o = i * 4;
          px[o] = r + grain;
          px[o + 1] = g + grain;
          px[o + 2] = b + grain;
          px[o + 3] = 255;
        }
      }
      this.bctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
    }

    // ---------- Flüsse als Path2D nach Breitenstufen ----------
    buildRivers(map, d) {
      const W = map.width;
      const T = d.riverThreshold;
      const unit = Math.min(map.width, map.height) / 750;
      const buckets = [];
      const NB = 7;
      for (let k = 0; k < NB; k++) buckets.push(new Path2D());
      const widthOf = (i) => {
        const f = Math.max(0, d.flux[i] - T) / (T * 25);
        return Math.min(NB - 1, Math.floor(Math.sqrt(f) * NB * 0.9));
      };
      const pt = (i) => {
        const x = i % W, y = (i / W) | 0;
        return [x + 0.5 + (FMM.hash2(x, y) - 0.5) * 0.7, y + 0.5 + (FMM.hash2(y + 7, x + 3) - 0.5) * 0.7];
      };
      for (const path of d.rivers) {
        const pts = path.map(pt);
        for (let k = 0; k < pts.length - 1; k++) {
          const a = path[k], bI = path[k + 1];
          if (d.lake[a] && d.lake[bI]) continue;
          const p0 = k > 0 ? [(pts[k - 1][0] + pts[k][0]) / 2, (pts[k - 1][1] + pts[k][1]) / 2] : pts[0];
          const p2 = [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2];
          const end = k === pts.length - 2 ? pts[k + 1] : p2;
          const pa = buckets[widthOf(a)];
          pa.moveTo(p0[0], p0[1]);
          pa.quadraticCurveTo(pts[k][0], pts[k][1], end[0], end[1]);
        }
      }
      this.riverCache = { buckets, widths: buckets.map((_, k) => (0.8 + k * 0.5) * unit) };
    }

    // ---------- Vektorebene ----------
    drawOverlay(ctx, map, d, view, opts) {
      opts = opts || {};
      const st = STYLE[map.view.style];
      const L = map.view.layers;
      const W = map.width, H = map.height;
      const unit = Math.min(W, H) / 750;
      ctx.save();
      ctx.setTransform(view.scale * (opts.dpr || 1), 0, 0, view.scale * (opts.dpr || 1), view.ox * (opts.dpr || 1), view.oy * (opts.dpr || 1));
      this.hitBoxes = [];

      if (L.rivers) {
        if (!this.riverCache) this.buildRivers(map, d);
        ctx.strokeStyle = st.river;
        ctx.globalAlpha = st.riverAlpha;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const rc = this.riverCache;
        for (let k = 0; k < rc.buckets.length; k++) {
          ctx.lineWidth = rc.widths[k];
          ctx.stroke(rc.buckets[k]);
        }
        ctx.globalAlpha = 1;
      }

      if (L.grid) this.drawGrid(ctx, map, unit);

      // Staatsnamen
      if (L.stateLabels && d.stateInfo) {
        for (const s of map.states) {
          const info = d.stateInfo[s.id];
          if (!info || info.area < 30) continue;
          const text = s.name.toUpperCase();
          const auto = FMM.clamp(Math.min(info.length / (text.length * 1.0), info.poleDist * 1.1), 7 * unit, 30 * unit);
          const size = s.labelSize ? s.labelSize * unit : auto;
          const x = s.labelX != null ? s.labelX : info.lx;
          const y = s.labelY != null ? s.labelY : info.ly;
          const angle = s.labelAngle != null ? s.labelAngle : info.angle;
          const color = map.view.style === 'political' ? darken(s.color, 0.45) : st.text;
          const box = this.drawText(ctx, text, x, y, {
            font: `600 ${size}px ${FONT_LABEL}`, color, halo: st.halo, haloWidth: size * 0.22, spacing: size * 0.18, angle, alpha: 0.88,
          });
          this.hitBoxes.push({ type: 'state', id: s.id, ...box });
          if (opts.selection && opts.selection.type === 'state' && opts.selection.id === s.id) this.drawSelBox(ctx, box, view);
        }
      }

      // Freie Beschriftungen & Meere
      if (L.labels) {
        for (const lb of map.labels) {
          const size = (lb.size || 14) * unit;
          const sea = lb.kind === 'sea';
          const box = this.drawText(ctx, sea ? spaced(lb.text) : lb.text, lb.x, lb.y, {
            font: `${sea ? 'italic ' : ''}${lb.bold ? '700 ' : ''}${size}px ${sea ? FONT_TEXT : lb.font === 'text' ? FONT_TEXT : FONT_LABEL}`,
            color: lb.color || (sea ? st.sea : st.text),
            halo: sea ? st.seaHalo : st.halo,
            haloWidth: size * (sea ? 0.12 : 0.22),
            spacing: sea ? size * 0.12 : size * 0.08,
            angle: lb.angle || 0,
            alpha: 0.92,
          });
          this.hitBoxes.push({ type: 'label', id: lb.id, ...box });
          if (opts.selection && opts.selection.type === 'label' && opts.selection.id === lb.id) this.drawSelBox(ctx, box, view);
        }
      }

      if (L.cities) {
        // erst Symbole, dann Namen – Hauptstädte zuletzt (oben)
        const order = map.cities.slice().sort((a, b) => rank(a.type) - rank(b.type));
        for (const c of order) this.drawCity(ctx, map, c, unit, st, opts, view);
      }

      if (L.compass) this.drawCompass(ctx, W - 62 * unit, 66 * unit, 40 * unit, map.view.style);
      if (L.scale) this.drawScale(ctx, map, unit, st);
      this.drawFrame(ctx, map, unit);

      ctx.restore();
    }

    drawText(ctx, text, x, y, o) {
      ctx.save();
      ctx.translate(x, y);
      if (o.angle) ctx.rotate(o.angle);
      ctx.font = o.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hasLS = 'letterSpacing' in ctx;
      if (hasLS) ctx.letterSpacing = (o.spacing || 0) + 'px';
      const w = ctx.measureText(text).width;
      const size = parseFloat(/(\d+(\.\d+)?)px/.exec(o.font)[1]);
      // Mittelpunkt bei letterSpacing korrigieren (wird hinter jedem Zeichen angehängt)
      const shift = hasLS ? (o.spacing || 0) / 2 : 0;
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      if (o.halo) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = o.haloWidth || 3;
        ctx.strokeStyle = o.halo;
        ctx.strokeText(text, shift, 0);
      }
      ctx.fillStyle = o.color;
      ctx.fillText(text, shift, 0);
      ctx.restore();
      return { x, y, w, h: size * 1.2, angle: o.angle || 0 };
    }

    drawSelBox(ctx, box, view) {
      ctx.save();
      ctx.translate(box.x, box.y);
      if (box.angle) ctx.rotate(box.angle);
      ctx.strokeStyle = '#e8a33d';
      ctx.lineWidth = 2 / view.scale;
      ctx.setLineDash([5 / view.scale, 4 / view.scale]);
      ctx.strokeRect(-box.w / 2 - 4 / view.scale, -box.h / 2, box.w + 8 / view.scale, box.h);
      ctx.restore();
    }

    drawCity(ctx, map, c, unit, st, opts, view) {
      const r = (c.type === 'capital' ? 4.2 : c.type === 'city' ? 3.1 : 2) * unit;
      ctx.save();
      ctx.lineWidth = 1.1 * unit;
      ctx.strokeStyle = st.city;
      ctx.fillStyle = st.cityFill;
      if (c.type === 'capital') {
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        star(ctx, c.x, c.y, r * 0.78, r * 0.33, 5);
        ctx.fillStyle = st.city; ctx.fill();
      } else if (c.type === 'city') {
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.4, 0, Math.PI * 2); ctx.fillStyle = st.city; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fillStyle = st.city; ctx.fill();
      }
      ctx.restore();
      const size = (c.type === 'capital' ? 13 : c.type === 'city' ? 11 : 9) * unit;
      const weight = c.type === 'capital' ? '700 ' : '';
      ctx.save();
      ctx.font = `${weight}${size}px ${FONT_TEXT}`;
      const tw = ctx.measureText(c.name).width;
      ctx.restore();
      const tx = c.x + r + 2 * unit + tw / 2;
      const ty = c.y - r * 0.2;
      const box = this.drawText(ctx, c.name, tx, ty, { font: `${weight}${size}px ${FONT_TEXT}`, color: st.text, halo: st.halo, haloWidth: size * 0.28 });
      this.hitBoxes.push({ type: 'city', id: c.id, x: c.x, y: c.y, r: r + 2 * unit, w: 0, h: 0 });
      this.hitBoxes.push({ type: 'city', id: c.id, ...box });
      if (opts.selection && opts.selection.type === 'city' && opts.selection.id === c.id) {
        ctx.save();
        ctx.strokeStyle = '#e8a33d';
        ctx.lineWidth = 2 / view.scale;
        ctx.setLineDash([4 / view.scale, 3 / view.scale]);
        ctx.beginPath(); ctx.arc(c.x, c.y, r + 4 / view.scale + 2 * unit, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    drawGrid(ctx, map, unit) {
      const W = map.width, H = map.height;
      const step = Math.round(Math.min(W, H) / 6);
      ctx.save();
      ctx.strokeStyle = map.view.style === 'antique' ? 'rgba(80,55,25,0.25)' : 'rgba(30,40,60,0.18)';
      ctx.lineWidth = 0.7 * unit;
      ctx.beginPath();
      for (let x = (W % step) / 2; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = (H % step) / 2; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.restore();
    }

    drawCompass(ctx, cx, cy, R, style) {
      const dark = style === 'antique' ? '#4a3420' : '#2b2b30';
      const light = style === 'antique' ? '#efe0bb' : '#f4f1ea';
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = R * 0.03;
      ctx.strokeStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.56, 0, Math.PI * 2); ctx.stroke();
      // Nebenrichtungen
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate(Math.PI / 4 + (k * Math.PI) / 2);
        point(ctx, R * 0.6, R * 0.1, dark, light);
        ctx.restore();
      }
      // Hauptrichtungen
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate((k * Math.PI) / 2);
        point(ctx, R, R * 0.16, dark, light);
        ctx.restore();
      }
      ctx.fillStyle = dark;
      ctx.font = `700 ${R * 0.32}px ${FONT_LABEL}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('N', 0, -R * 1.02);
      ctx.restore();
    }

    drawScale(ctx, map, unit, st) {
      const km = map.settings.kmPerPixel || 4;
      const target = map.width * 0.16 * km;
      const pow = Math.pow(10, Math.floor(Math.log10(target)));
      const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() || pow;
      const len = nice / km;
      const x = 24 * unit, y = map.height - 26 * unit, hgt = 5 * unit;
      ctx.save();
      ctx.globalAlpha = 0.9;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? st.cityFill : st.city;
        ctx.fillRect(x + (len / 4) * k, y, len / 4, hgt);
      }
      ctx.strokeStyle = st.city;
      ctx.lineWidth = 0.8 * unit;
      ctx.strokeRect(x, y, len, hgt);
      ctx.restore();
      this.drawText(ctx, '0', x, y - 7 * unit, { font: `${10 * unit}px ${FONT_TEXT}`, color: st.text, halo: st.halo, haloWidth: 3 * unit });
      this.drawText(ctx, nice.toLocaleString('de-DE') + ' km', x + len, y - 7 * unit, { font: `${10 * unit}px ${FONT_TEXT}`, color: st.text, halo: st.halo, haloWidth: 3 * unit });
    }

    drawFrame(ctx, map, unit) {
      const W = map.width, H = map.height;
      ctx.save();
      if (map.view.style === 'antique') {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(90,60,20,0)');
        g.addColorStop(1, 'rgba(90,60,20,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#4a3420';
        ctx.lineWidth = 3 * unit;
        ctx.strokeRect(5 * unit, 5 * unit, W - 10 * unit, H - 10 * unit);
        ctx.lineWidth = 1 * unit;
        ctx.strokeRect(10 * unit, 10 * unit, W - 20 * unit, H - 20 * unit);
      } else {
        ctx.strokeStyle = 'rgba(20,20,25,0.7)';
        ctx.lineWidth = 2 * unit;
        ctx.strokeRect(unit, unit, W - 2 * unit, H - 2 * unit);
      }
      ctx.restore();
    }

    // Kompletten Export rendern
    exportCanvas(map, d, factor) {
      const c = document.createElement('canvas');
      c.width = Math.round(map.width * factor);
      c.height = Math.round(map.height * factor);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.base, 0, 0, c.width, c.height);
      const saved = this.hitBoxes;
      this.drawOverlay(ctx, map, d, { scale: factor, ox: 0, oy: 0 }, {});
      this.hitBoxes = saved;
      return c;
    }
  }

  function rank(t) { return t === 'capital' ? 2 : t === 'city' ? 1 : 0; }
  function spaced(t) { return t; }

  function darken(hex, f) {
    const c = FMM.hexToRgb(hex);
    return `rgb(${Math.round(c[0] * (1 - f))},${Math.round(c[1] * (1 - f))},${Math.round(c[2] * (1 - f))})`;
  }

  function star(ctx, x, y, ro, ri, n) {
    ctx.beginPath();
    for (let k = 0; k < n * 2; k++) {
      const a = (k * Math.PI) / n - Math.PI / 2;
      const r = k % 2 ? ri : ro;
      if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function point(ctx, len, wid, dark, light) {
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(wid, 0); ctx.lineTo(0, 0); ctx.closePath();
    ctx.fillStyle = dark; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(-wid, 0); ctx.lineTo(0, 0); ctx.closePath();
    ctx.fillStyle = light; ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = len * 0.02; ctx.stroke();
  }

  FMM.Renderer = Renderer;
})();
