/* Darstellung: Rasterbild (Gelände, Staaten) + Vektorebene (Flüsse, Städte, Beschriftungen) */
(function () {
  'use strict';
  const FMM = window.FMM;

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
    geo: { river: '#3473ab', riverAlpha: 0.92, text: '#1d1a16', halo: 'rgba(255,255,255,0.75)', sea: '#d8ecf5', seaHalo: 'rgba(20,50,80,0.55)', city: '#1d1a16', cityFill: '#ffffff', border: [120, 30, 30] },
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
      // doppelte Auflösung für glatte Küsten und Übergänge (bei sehr großen Karten einfach)
      this.S = map.width * map.height <= 2000000 ? 2 : 1;
      this.base.width = map.width * this.S;
      this.base.height = map.height * this.S;
      this.img = this.bctx.createImageData(this.base.width, this.base.height);
      // Pergamenttextur (feste Saat, damit sie beim Bearbeiten stabil bleibt)
      const N = map.width * map.height;
      this.paper = new Float32Array(N);
      const noise = FMM.createNoise2D(FMM.makeRng('pergament'));
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          this.paper[y * map.width + x] = FMM.fbm(noise, x / 90, y / 90, 4, 2.2, 0.55);
        }
      }
      // Variationsrauschen für Landschaftsformen: großräumig (Grenzen) und fein (Baumkronen, Dünen)
      const seed = (map.settings && map.settings.seed) || 'welt';
      const nv = FMM.createNoise2D(FMM.makeRng(seed + 'veg'));
      const nf = FMM.createNoise2D(FMM.makeRng(seed + 'fein'));
      this.veg = new Float32Array(N);
      this.fine = new Float32Array(N);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const i = y * map.width + x;
          this.veg[i] = FMM.fbm(nv, x / 40, y / 40, 4, 2, 0.5);
          this.fine[i] = nf(x / 2.2, y / 2.2) * 0.65 + nf(x / 1.1 + 40, y / 1.1) * 0.35;
        }
      }
      this.biome = new Uint8Array(N).fill(255);
      this.biomeCount = null;
      this.riverCache = null;
      this.coastCache = null;
      this.borderCache = null;
      this.roadCache = null;
      this.symbolCache = null;
      this.live = null;
    }

    // Gelände geändert: Flüsse, Küsten, Grenzen und Straßen neu aufbauen
    invalidateRivers() { this.riverCache = null; this.coastCache = null; this.borderCache = null; this.roadCache = null; this.symbolCache = null; }
    invalidateSymbols() { this.symbolCache = null; }
    invalidateBorders() { this.borderCache = null; }
    invalidateRoads() { this.roadCache = null; this.symbolCache = null; }

    // ---------- Rasterbild (Supersampling: S×S Pixel pro Kartenzelle) ----------
    renderBase(map, d, rect) {
      const W = map.width, H = map.height, S = this.S;
      const cx0 = rect ? Math.max(0, rect.x0 | 0) : 0;
      const cy0 = rect ? Math.max(0, rect.y0 | 0) : 0;
      const cx1 = rect ? Math.min(W, Math.ceil(rect.x1)) : W;
      const cy1 = rect ? Math.min(H, Math.ceil(rect.y1)) : H;
      if (cx1 <= cx0 || cy1 <= cy0) return;
      const PW = W * S;

      const style = map.view.style;
      const L = map.view.layers;
      const h = map.heights, moist = map.moisture, sm = map.stateMap;
      const lake = d.lake, cd = d.coastDist, bd = d.borderDist, latT = d.latT;
      const paper = this.paper, veg = this.veg, fine = this.fine, biome = this.biome;
      const rdist = d.riverDist, bmap = map.biomeMap, curv = d.curv;
      const px = this.img.data;
      const BI = FMM.BIOME_ID;
      const forest = FMM.BIOMES.map((b) => FMM.isForest(b.id));
      const slopeK = 40 * (W / 1200);

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
      const reliefAmt = L.relief ? (style === 'geo' ? 0.8 : style === 'political' ? 0.7 : 0.9) : 0;
      const sty = style === 'geo' ? 0 : style === 'political' ? 1 : 2;
      const maxShade = sty === 0 ? 1.25 : sty === 1 ? 1.15 : 1.12;
      const Wm = W - 1, Hm = H - 1;

      // Gradient pro Zelle (zentrale Differenz), später bilinear interpoliert → weiches Relief ohne Facetten
      if (!this.gxC || this.gxC.length !== W * H) { this.gxC = new Float32Array(W * H); this.gyC = new Float32Array(W * H); }
      const gxC = this.gxC, gyC = this.gyC;
      for (let y = Math.max(0, cy0 - 2); y < Math.min(H, cy1 + 2); y++) {
        for (let x = Math.max(0, cx0 - 2); x < Math.min(W, cx1 + 2); x++) {
          const i = y * W + x;
          const l = x > 0 ? i - 1 : i, r = x < Wm ? i + 1 : i, u = y > 0 ? i - W : i, dn = y < Hm ? i + W : i;
          if (h[i] < 0) { gxC[i] = h[r] - h[l]; gyC[i] = h[dn] - h[u]; }
          else {
            gxC[i] = Math.max(0, h[r]) - Math.max(0, h[l]);
            gyC[i] = Math.max(0, h[dn]) - Math.max(0, h[u]);
          }
        }
      }


      for (let Y = cy0 * S; Y < cy1 * S; Y++) {
        let fy = (Y + 0.5) / S - 0.5;
        if (fy < 0) fy = 0; else if (fy > Hm) fy = Hm;
        const cy = (Y / S) | 0;
        const iy = fy | 0, ty = fy - iy, iyd = iy < Hm ? W : 0;
        const lt = latT[iy] + (latT[iy < Hm ? iy + 1 : iy] - latT[iy]) * ty;
        for (let X = cx0 * S; X < cx1 * S; X++) {
          let fx = (X + 0.5) / S - 0.5;
          if (fx < 0) fx = 0; else if (fx > Wm) fx = Wm;
          const cx = (X / S) | 0;
          const i = cy * W + cx;
          // bilineare Gewichte der vier umgebenden Zellmittelpunkte
          const ix = fx | 0, tx = fx - ix;
          const i00 = iy * W + ix, i10 = i00 + (ix < Wm ? 1 : 0), i01 = i00 + iyd, i11 = i10 + iyd;
          const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
          const h00 = h[i00], h10 = h[i10], h01 = h[i01], h11 = h[i11];
          const hv = h00 * w00 + h10 * w10 + h01 * w01 + h11 * w11;
          const ocean = hv < 0;
          const isLake = !ocean && lake[i00] * w00 + lake[i10] * w10 + lake[i01] * w01 + lake[i11] * w11 >= 0.5;
          let r, g, b;

          const gx = gxC[i00] * w00 + gxC[i10] * w10 + gxC[i01] * w01 + gxC[i11] * w11;
          const gy = gyC[i00] * w00 + gyC[i10] * w10 + gyC[i01] * w01 + gyC[i11] * w11;

          let shade = 1;
          // Krümmung (Grate hell, Täler dunkel)
          const cv = ocean ? 0 : curv[i00] * w00 + curv[i10] * w10 + curv[i01] * w01 + curv[i11] * w11;
          if (reliefAmt > 0 && !isLake && (!ocean || sty === 0)) {
            // Relief wird mit der Höhe kräftiger: Tiefland ruhig, Gebirge plastisch
            const z = ocean ? zSea : zLand * (0.7 + hv * 0.9);
            const nx = -gx * z, ny = -gy * z;
            const len = Math.sqrt(nx * nx + ny * ny + 1);
            const dot = (nx * lx + ny * ly + lz) / len;
            shade = 1 + (dot / lz - 1) * reliefAmt * (ocean ? 0.6 : 1);
            if (!ocean) shade *= 1 + FMM.clamp(cv * 5, -0.22, 0.14) * reliefAmt;
            if (shade < 0.3) shade = 0.3; else if (shade > maxShade) shade = maxShade;
          }

          if (ocean) {
            const depth = -hv;
            const cdi = cd[i00] * w00 + cd[i10] * w10 + cd[i01] * w01 + cd[i11] * w11;
            if (sty === 0) {
              const k = Math.min(255, (depth * 255) | 0) * 3;
              r = OCEAN_LUT[k]; g = OCEAN_LUT[k + 1]; b = OCEAN_LUT[k + 2];
              // Flachwasser und Brandung entlang der Küste
              if (cdi < 4) { const f = (4 - cdi) * 0.075; r += (160 - r) * f; g += (212 - g) * f; b += (214 - b) * f; }
              if (depth < 0.012) { const f = (0.012 - depth) / 0.012 * 0.45; r += (205 - r) * f; g += (232 - g) * f; b += (230 - b) * f; }
              const fo = fine[i00] * w00 + fine[i10] * w10 + fine[i01] * w01 + fine[i11] * w11;
              // Watt: flaches Küstenmeer in gemäßigten Breiten, bei Ebbe trockenfallender Schlick
              if (depth < 0.03 && cdi < 8 && lt > 0.22 && lt < 0.62) {
                const gm = Math.sqrt(gx * gx + gy * gy);
                const f = (1 - depth / 0.03) * (1 - FMM.smoothstep(0.002, 0.009, gm)) * (0.45 + 0.2 * fo);
                if (f > 0) { r += (156 - r) * f; g += (150 - g) * f; b += (120 - b) * f; }
              }
              // Tropen: türkisfarbene Lagunen und ein Saumriff mit Lücken
              if (lt > 0.68 && depth < 0.07) {
                const wt = FMM.smoothstep(0.68, 0.8, lt);
                const f = (1 - depth / 0.07) * 0.75 * wt;
                r += (62 - r) * f; g += (196 - g) * f; b += (190 - b) * f;
                if (depth > 0.038 && depth < 0.05 && fo > 0.05) { const q = 0.55 * wt; r += (214 - r) * q; g += (236 - g) * q; b += (222 - b) * q; }
              }
              if (lt < 0.06) { const f = FMM.smoothstep(0.06, -0.04, lt) * 0.85; r += (226 - r) * f; g += (236 - g) * f; b += (242 - b) * f; }
            } else if (sty === 1) {
              r = 170 - depth * 40; g = 205 - depth * 35; b = 224 - depth * 20;
              if (Math.abs(cdi - 3) < 0.35 || Math.abs(cdi - 8) < 0.35 || Math.abs(cdi - 15) < 0.35) { r -= 24; g -= 18; b -= 10; }
            } else {
              const pp = paper[i] * 10;
              r = 205 + pp - depth * 25; g = 192 + pp - depth * 25; b = 158 + pp - depth * 22;
              if (Math.abs(cdi - 3) < 0.35 || Math.abs(cdi - 7) < 0.35 || Math.abs(cdi - 12) < 0.35) { r -= 32; g -= 32; b -= 28; }
            }
            shade = 1 + (shade - 1) * 0.5;
          } else if (isLake) {
            if (sty === 0) { r = 56; g = 110; b = 158; }
            else if (sty === 1) { r = 150; g = 192; b = 214; }
            else { r = 180; g = 170; b = 140; }
          } else {
            const t = FMM.cellTemp(lt, hv);
            if (sty === 0) {
              // Landschaftsform bestimmen
              const slope = Math.sqrt(gx * gx + gy * gy) * slopeK;
              const v = veg[i00] * w00 + veg[i10] * w10 + veg[i01] * w01 + veg[i11] * w11;
              const fn = fine[i00] * w00 + fine[i10] * w10 + fine[i01] * w01 + fine[i11] * w11;
              const rdi = rdist[i00] * w00 + rdist[i10] * w10 + rdist[i01] * w01 + rdist[i11] * w11;
              const ov = bmap[i];
              const mI = moist[i00] * w00 + moist[i10] * w10 + moist[i01] * w01 + moist[i11] * w11;
              let bi, bOther = -1;
              if (ov !== 255) bi = ov;
              else {
                // weiche Übergänge: in der Grenzzone zweier Landschaften pixelweise mischen
                // (einzelne Bäume vor dem Waldrand, Grasinseln, auslaufende Steppe)
                const bLo = FMM.classifyBiome(t - 0.02, mI - 0.045, hv, slope, rdi, v, fn);
                const bHi = FMM.classifyBiome(t + 0.02, mI + 0.045, hv, slope, rdi, v, fn);
                if (bLo === bHi) bi = bLo;
                else {
                  const pick = FMM.hash2(X + 17, Y * 3 + 5) * 0.55 + (fn * 0.5 + 0.5) * 0.45;
                  bi = pick < 0.5 ? bLo : bHi;
                  bOther = bi === bLo ? bHi : bLo;
                }
              }
              biome[i] = bi;
              const c = FMM.BIOMES[bi].color;
              r = c[0]; g = c[1]; b = c[2];
              if (bOther >= 0 && !forest[bi]) {
                const oc = FMM.BIOMES[bOther].color;
                r += (oc[0] - r) * 0.28; g += (oc[1] - g) * 0.28; b += (oc[2] - b) * 0.28;
              }
              if (forest[bi]) {
                // Baumkronen: weiche Struktur + einzelne Kronen/Lücken, leichte Farbvariation im Laubwald
                let k = 0.82 + fn * 0.22;
                const hh = FMM.hash2(X, Y);
                if (hh > 0.8) k *= 0.8; else if (hh < 0.1) k *= 1.1;
                if (bi === BI.wald) { const q = FMM.clamp(0.5 + v, 0, 1) * 0.3; r += (104 - r) * q; g += (128 - g) * q; b += (58 - b) * q; }
                r *= k; g *= k; b *= k;
              } else if (bi === BI.wueste) {
                const k = 0.95 + 0.06 * Math.sin(fx * 0.55 + fy * 0.2 + v * 18); // Dünen
                r *= k; g *= k; b *= k;
              } else if (bi === BI.sumpf) {
                if (fn > 0.3) { r = (r + 70) / 2; g = (g + 108) / 2; b = (b + 124) / 2; } // Wasserlachen
              } else if (bi === BI.savanne) {
                if (fn > 0.5) { r *= 0.62; g *= 0.7; b *= 0.55; } // Baumgruppen
              } else if (bi === BI.fels) {
                // Gesteinsschichten
                const k = 0.9 + fn * 0.08 + 0.05 * Math.sin(hv * 90 + v * 6);
                r *= k; g *= k; b *= k;
              } else if (bi !== BI.gletscher) {
                const k = 0.95 + v * 0.07 + fn * 0.03;
                r *= k; g *= k; b *= k;
              }
              // Schneegrenze abhängig vom Breitengrad: im Kalten tiefer, im Warmen höher.
              // Grate (positive Krümmung) tragen mehr Schnee, Täler weniger.
              const snowLine = FMM.clamp(0.58 + (lt - 0.3) * 0.7, 0.36, 0.95);
              const snow = ov !== 255 && bi !== BI.fels ? 0
                : FMM.smoothstep(snowLine + 0.03, snowLine + 0.17, hv + cv * 3.5 + v * 0.03) * (bi === BI.fels ? 1 : 0.8);
              if (snow > 0 && bi !== BI.gletscher) { r += (244 - r) * snow; g += (247 - g) * snow; b += (250 - b) * snow; }
              // Küsten: Steilküste mit dunklen Klippen, flache Küste mit Sandstrand
              const cdl = cd[i00] * w00 + cd[i10] * w10 + cd[i01] * w01 + cd[i11] * w11;
              if (cdl < 2.5 && slope > 0.5) {
                const f = FMM.smoothstep(0.5, 1.2, slope) * (1 - cdl / 2.5) * 0.75;
                r += (100 - r) * f; g += (92 - g) * f; b += (84 - b) * f;
              } else if (hv < 0.022 && t > 0.28 && slope < 0.5) {
                const f = ((0.022 - hv) / 0.022) * 0.75 * (1 - slope / 0.5);
                r += (222 - r) * f; g += (207 - g) * f; b += (166 - b) * f;
              }
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

          // Staatsfarben (Zelle kann am Küstensaum Meer sein → Nachbarstaat verwenden)
          if (!ocean && L.stateFill) {
            let s = sm[i], si = i;
            if (h[i] < 0) {
              s = 0;
              if (cx < Wm && h[i + 1] >= 0) { s = sm[i + 1]; si = i + 1; }
              else if (cx > 0 && h[i - 1] >= 0) { s = sm[i - 1]; si = i - 1; }
              else if (cy < Hm && h[i + W] >= 0) { s = sm[i + W]; si = i + W; }
              else if (cy > 0 && h[i - W] >= 0) { s = sm[i - W]; si = i - W; }
            }
            if (s && sValid[s]) {
              let a = sty === 1 ? 0.42 : 0.28;
              const dist = bd[si];
              if (dist < 4) a += (4 - dist) * 0.07;
              if (isLake) a *= 0.25;
              r += (sr[s] - r) * a; g += (sg[s] - g) * a; b += (sb[s] - b) * a;
            }
          }

          // feines Korn
          const grain = (FMM.hash2(X, Y) - 0.5) * (sty === 0 ? 6 : 8);
          const o = (Y * PW + X) * 4;
          px[o] = r + grain;
          px[o + 1] = g + grain;
          px[o + 2] = b + grain;
          px[o + 3] = 255;
        }
      }
      this.bctx.putImageData(this.img, 0, 0, cx0 * S, cy0 * S, (cx1 - cx0) * S, (cy1 - cy0) * S);
      if (!rect) this.biomeCount = null;
    }

    // ---------- Flüsse als Path2D nach Breitenstufen ----------
    buildRivers(map, d) {
      const W = map.width, H = map.height;
      const T = d.riverThreshold;
      const unit = Math.min(W, H) / 750;
      const NB = 28, minW = 0.45, maxW = 3.2, topW = 8;
      const buckets = Array.from({ length: NB }, () => new Path2D());
      // stufenlose Breite: dünn an der Quelle, breit an der Mündung
      const widthOf = (f) => minW + (maxW - minW) * Math.sqrt(FMM.clamp((f - T) / (T * 40), 0, 1));
      const bucketOf = (w) => Math.min(NB - 1, Math.max(0, Math.round(((w - minW) / (topW - minW)) * (NB - 1))));
      const hAt = (x, y) => map.heights[FMM.clamp(Math.floor(y), 0, H - 1) * W + FMM.clamp(Math.floor(x), 0, W - 1)];
      const noise = FMM.createNoise2D(FMM.makeRng('maeander'));

      for (const path of d.rivers) {
        // Punkte als [x, y, Breite, ausblenden] (ausblenden: in Seen und auf Gletschern)
        let P = [];
        for (const i of path) {
          const x = i % W, y = (i / W) | 0;
          const hide = d.lake[i] || FMM.cellTemp(d.latT[y], Math.max(0, map.heights[i])) < 0.03 ? 1 : 0;
          P.push(x + 0.5, y + 0.5, widthOf(d.flux[i]), hide);
        }
        P = chaikin4(chaikin4(P));
        const n = P.length / 4;
        if (n < 2) continue;

        // Mäander: seitliche Auslenkung, stark im Flachland, schwach im Gebirge
        const out = P.slice();
        const ph = FMM.hash2(path[0] % W, (path[0] / W) | 0) * 100;
        let sLen = 0;
        for (let k = 1; k < n - 1; k++) {
          const dx = P[4 * k + 4] - P[4 * k - 4], dy = P[4 * k + 5] - P[4 * k - 3];
          const len = Math.hypot(dx, dy) || 1;
          sLen += Math.hypot(P[4 * k] - P[4 * k - 4], P[4 * k + 1] - P[4 * k - 3]);
          const ci = FMM.clamp(Math.floor(P[4 * k + 1]), 0, H - 1) * W + FMM.clamp(Math.floor(P[4 * k]), 0, W - 1);
          const flat = 1 - FMM.smoothstep(0.02, 0.22, map.heights[ci]);
          const amp = flat * Math.min(1, P[4 * k + 2] / 1.4) * 1.1;
          const fade = Math.min(1, k / 8, (n - 1 - k) / 8);
          const off = amp * fade * (0.65 * Math.sin(sLen * 0.55 + ph) + 0.6 * noise(sLen * 0.18, ph));
          out[4 * k] += (-dy / len) * off;
          out[4 * k + 1] += (dx / len) * off;
        }

        const toSea = map.heights[path[path.length - 1]] < 0;
        const mouthW = out[4 * (n - 1) + 2];
        if (toSea && mouthW > 1.2) {
          // Delta: großer Fluss an flacher Küste fächert in Nebenarme auf
          const E = Math.min(n - 5, 56); // ca. 14 Zellen vor der Mündung
          let flat = E > 20;
          for (let j = 0; j < E && flat; j += 4) if (hAt(out[4 * (n - 1 - j)], out[4 * (n - 1 - j) + 1]) > 0.05) flat = false;
          if (flat && mouthW > 2.3) {
            const kb = n - 1 - E;
            const bx = out[4 * kb], by = out[4 * kb + 1];
            let ddx = out[4 * kb] - out[4 * (kb - 4)], ddy = out[4 * kb + 1] - out[4 * (kb - 4)];
            const dl = Math.hypot(ddx, ddy) || 1;
            ddx /= dl; ddy /= dl;
            for (const side of [-1, 1]) {
              const ang = side * (0.45 + FMM.hash2(bx | 0, side + 9) * 0.3);
              let dx = ddx * Math.cos(ang) - ddy * Math.sin(ang), dy = ddx * Math.sin(ang) + ddy * Math.cos(ang);
              let x = bx, y = by, reached = false;
              const arm = new Path2D();
              arm.moveTo(x, y);
              for (let st = 0; st < 40; st++) {
                const turn = -side * 0.035;
                const ndx = dx * Math.cos(turn) - dy * Math.sin(turn);
                dy = dx * Math.sin(turn) + dy * Math.cos(turn); dx = ndx;
                x += dx * 0.8; y += dy * 0.8;
                arm.lineTo(x, y);
                if (hAt(x, y) < -0.004) { reached = true; break; }
              }
              if (reached) buckets[bucketOf(mouthW * 0.42)].addPath(arm);
            }
          }
          // Mündungstrichter: die letzten Zellen weiten sich
          for (let j = 0; j < E; j++) {
            const k = n - 1 - j, t = 1 - j / E;
            out[4 * k + 2] *= 1 + 1.6 * t * t;
          }
        }

        for (let k = 0; k < n - 1; k++) {
          if (out[4 * k + 3] >= 0.5 && out[4 * k + 7] >= 0.5) continue;
          const pa = buckets[bucketOf((out[4 * k + 2] + out[4 * k + 6]) / 2)];
          pa.moveTo(out[4 * k], out[4 * k + 1]);
          pa.lineTo(out[4 * k + 4], out[4 * k + 5]);
        }
      }
      this.riverCache = { buckets, widths: buckets.map((_, k) => (minW + (k / (NB - 1)) * (topW - minW)) * unit) };
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
      const sty = map.view.style;

      // Küstenlinien und Seeufer (während eines Geländestrichs ausgeblendet, da veraltet)
      if (this.live !== 'terrain') {
        if (!this.coastCache) {
          this.coastCache = {
            coast: FMM.Contours.toPath(FMM.Contours.coastlines(map)),
            lakes: FMM.Contours.toPath(FMM.Contours.lakeShores(map, d)),
          };
        }
        const cc = this.coastCache;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (sty === 'geo') {
          ctx.strokeStyle = 'rgba(225,242,240,0.35)';
          ctx.lineWidth = 2.4 * unit;
          ctx.stroke(cc.coast);
          ctx.strokeStyle = 'rgba(28,48,58,0.6)';
          ctx.lineWidth = 0.75 * unit;
          ctx.stroke(cc.coast);
          ctx.strokeStyle = 'rgba(28,48,58,0.45)';
          ctx.lineWidth = 0.6 * unit;
          ctx.stroke(cc.lakes);
        } else {
          ctx.strokeStyle = sty === 'political' ? 'rgba(52,66,74,0.9)' : 'rgba(74,52,32,0.95)';
          ctx.lineWidth = (sty === 'political' ? 1.0 : 1.3) * unit;
          ctx.stroke(cc.coast);
          ctx.lineWidth = 0.8 * unit;
          ctx.stroke(cc.lakes);
        }
      }

      if (L.rivers) {
        if (!this.riverCache) this.buildRivers(map, d);
        ctx.strokeStyle = st.river;
        ctx.globalAlpha = st.riverAlpha;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const rc = this.riverCache;
        for (let k = 0; k < rc.buckets.length; k++) {
          ctx.lineWidth = rc.widths[k] * (map.view.style === 'geo' ? 1.35 : 1);
          ctx.stroke(rc.buckets[k]);
        }
        ctx.globalAlpha = 1;
      }

      // Staatsgrenzen
      if (L.borders && this.live !== 'terrain' && this.live !== 'state') {
        if (!this.borderCache) this.borderCache = FMM.Contours.toPath(FMM.Contours.borders(map));
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (sty === 'political') {
          ctx.strokeStyle = 'rgba(255,252,244,0.55)';
          ctx.lineWidth = 2.6 * unit;
          ctx.stroke(this.borderCache);
          ctx.strokeStyle = 'rgba(64,48,44,0.85)';
          ctx.lineWidth = 1.1 * unit;
          ctx.stroke(this.borderCache);
        } else {
          ctx.strokeStyle = sty === 'geo' ? 'rgba(130,28,28,0.75)' : 'rgba(122,52,36,0.85)';
          ctx.lineWidth = (sty === 'geo' ? 1.0 : 1.2) * unit;
          ctx.setLineDash(sty === 'geo' ? [4 * unit, 2.5 * unit] : [5 * unit, 2 * unit, 1 * unit, 2 * unit]);
          ctx.stroke(this.borderCache);
        }
        ctx.restore();
      }

      // Straßen
      if (L.roads && this.live !== 'terrain') {
        if (!this.roadCache) {
          const r = FMM.buildRoads(map, d);
          this.roadCache = { main: FMM.Contours.toPath(r.main), minor: FMM.Contours.toPath(r.minor), count: r.main.length + r.minor.length };
        }
        const rc = this.roadCache;
        const col = sty === 'geo' ? 'rgba(92,58,32,0.9)' : sty === 'political' ? 'rgba(120,72,44,0.85)' : 'rgba(70,46,24,0.9)';
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (sty === 'geo') {
          // heller Rand lässt Straßen auf dunklem Wald gut sichtbar werden
          ctx.strokeStyle = 'rgba(244,232,198,0.7)';
          ctx.lineWidth = 3 * unit;
          ctx.stroke(rc.main);
          ctx.lineWidth = 2 * unit;
          ctx.stroke(rc.minor);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = (sty === 'geo' ? 1.5 : 1.2) * unit;
        ctx.stroke(rc.main);
        ctx.lineWidth = (sty === 'geo' ? 1 : 0.8) * unit;
        ctx.setLineDash([2.2 * unit, 1.8 * unit]);
        ctx.stroke(rc.minor);
        ctx.restore();
      }

      // gezeichnete Symbole (Berge, Hügel, Bäume)
      if (L.symbols && this.live !== 'terrain') {
        if (!this.symbolCache) this.symbolCache = FMM.buildSymbols(map, d, this);
        FMM.drawSymbols(ctx, this.symbolCache, sty, unit);
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

      if (L.legend) this.drawLegend(ctx, map, unit, st);
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

    // Legende der Landschaftsformen (nur die auf der Karte vorkommenden)
    drawLegend(ctx, map, unit, st) {
      if (map.view.style !== 'geo') return;
      if (!this.biomeCount) this.countBiomes(map);
      const total = this.biomeCount.reduce((a, b) => a + b, 0) || 1;
      const items = FMM.BIOMES.filter((b) => this.biomeCount[b.id] / total > 0.004)
        .map((b) => ({ name: b.name, color: `rgb(${b.color.join(',')})` }));
      items.push({ name: 'Fluss', line: st.river }, { name: 'See / Meer', color: 'rgb(56,110,158)' });
      if (map.view.layers.roads) items.push({ name: 'Straße', line: 'rgba(92,58,32,0.9)' }, { name: 'Weg', line: 'rgba(92,58,32,0.9)', dash: true });
      const fs = 10 * unit, row = 14 * unit, pad = 8 * unit, sw = 14 * unit;
      ctx.save();
      ctx.font = `${fs}px ${FONT_TEXT}`;
      const tw = Math.max(...items.map((it) => ctx.measureText(it.name).width), ctx.measureText('Legende').width);
      const bw = pad * 2 + sw + 6 * unit + tw;
      const bh = pad * 2 + row * (items.length + 1);
      const x = map.width - bw - 14 * unit, y = map.height - bh - 14 * unit;
      ctx.fillStyle = 'rgba(248,245,238,0.88)';
      ctx.strokeStyle = 'rgba(40,40,40,0.6)';
      ctx.lineWidth = 0.8 * unit;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = st.text;
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fs}px ${FONT_TEXT}`;
      ctx.fillText('Legende', x + pad, y + pad + row / 2);
      ctx.font = `${fs}px ${FONT_TEXT}`;
      items.forEach((it, k) => {
        const yy = y + pad + row * (k + 1);
        if (it.line) {
          ctx.strokeStyle = it.line;
          ctx.lineWidth = (it.dash ? 1 : 2) * unit;
          ctx.setLineDash(it.dash ? [2.2 * unit, 1.8 * unit] : []);
          ctx.beginPath(); ctx.moveTo(x + pad, yy + row / 2); ctx.lineTo(x + pad + sw, yy + row / 2); ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = it.color;
          ctx.fillRect(x + pad, yy + 2 * unit, sw, row - 4 * unit);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 0.6 * unit;
          ctx.strokeRect(x + pad, yy + 2 * unit, sw, row - 4 * unit);
        }
        ctx.fillStyle = st.text;
        ctx.fillText(it.name, x + pad + sw + 6 * unit, yy + row / 2);
      });
      ctx.restore();
    }

    countBiomes(map) {
      const cnt = new Array(FMM.BIOMES.length).fill(0);
      const bm = this.biome, h = map.heights;
      for (let i = 0; i < bm.length; i++) if (h[i] >= 0 && bm[i] < cnt.length) cnt[bm[i]]++;
      this.biomeCount = cnt;
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

  // Chaikin-Glättung für Punkte mit vier Werten [x, y, Breite, Maske]; Endpunkte bleiben
  function chaikin4(p) {
    const n = p.length / 4;
    if (n < 3) return p;
    const out = [p[0], p[1], p[2], p[3]];
    for (let k = 0; k < n - 1; k++) {
      const a = 4 * k, b = 4 * k + 4;
      for (const [f, g] of [[0.75, 0.25], [0.25, 0.75]]) {
        out.push(p[a] * f + p[b] * g, p[a + 1] * f + p[b + 1] * g, p[a + 2] * f + p[b + 2] * g, Math.max(p[a + 3], p[b + 3]) > 0 && Math.min(p[a + 3], p[b + 3]) > 0 ? 1 : 0);
      }
    }
    out.push(p[4 * n - 4], p[4 * n - 3], p[4 * n - 2], p[4 * n - 1]);
    return out;
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
