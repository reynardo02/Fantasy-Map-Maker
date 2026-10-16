/* Darstellung: Rasterbild (Gelände, Staaten) + Vektorebene (Flüsse, Städte, Beschriftungen) */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Wasserfarben nach Tiefe (ruhiger, natürlicher Verlauf)
  const OCEAN_STOPS = [
    [0, [96, 158, 178]],
    [0.05, [62, 128, 162]],
    [0.25, [34, 84, 132]],
    [1, [14, 38, 78]],
  ];

  // Natürliche Landfarbe: stufenlos aus Temperatur (Zeilen) und Feuchtigkeit (Spalten),
  // angelehnt an Satellitenbilder – kein hartes Umschalten zwischen Landschaftstypen
  const NAT_T = [-0.1, 0.15, 0.35, 0.55, 0.75, 0.95];
  const NAT_M = [0, 0.3, 0.6, 1];
  const NAT = [
    [[226, 230, 232], [228, 232, 234], [230, 234, 236], [232, 236, 238]], // polar
    [[156, 146, 122], [144, 140, 114], [120, 126, 98], [102, 114, 88]], // Tundra
    [[170, 156, 120], [140, 142, 96], [86, 112, 66], [56, 86, 56]], // boreal
    [[192, 174, 128], [158, 160, 96], [94, 132, 60], [60, 104, 46]], // gemäßigt
    [[210, 186, 138], [184, 170, 104], [118, 140, 62], [54, 106, 42]], // warm
    [[224, 198, 148], [202, 178, 112], [126, 144, 60], [40, 96, 38]], // heiß
  ];
  // Gemalte Fantasy-Karte: helle Aquarelltöne – gelbgrünes Tiefland, Ocker, rötliche Wüsten
  const FAN = [
    [[240, 242, 240], [240, 242, 240], [240, 242, 240], [240, 242, 240]], // polar
    [[206, 204, 178], [200, 202, 172], [190, 198, 162], [180, 192, 154]], // Tundra
    [[214, 200, 156], [206, 204, 148], [188, 200, 132], [168, 190, 120]], // boreal
    [[226, 208, 150], [216, 212, 142], [200, 210, 132], [178, 202, 118]], // gemäßigt
    [[230, 190, 136], [226, 204, 140], [206, 208, 126], [176, 198, 108]], // warm
    [[226, 160, 112], [228, 186, 128], [204, 198, 118], [164, 190, 98]], // heiß
  ];
  const NL = 96;
  const pickStop = (arr, v) => { let k = 0; while (k < arr.length - 2 && v > arr[k + 1]) k++; return [k, FMM.clamp((v - arr[k]) / (arr[k + 1] - arr[k]), 0, 1)]; };
  // Temperatur × Feuchte → Farbe, stufenlos (bilinear mit weichen Übergängen)
  function buildLut(table) {
    const lut = new Uint8Array(NL * NL * 3);
    for (let ti = 0; ti < NL; ti++) {
      const [a, fa] = pickStop(NAT_T, -0.1 + (ti / (NL - 1)) * 1.05);
      const sa = fa * fa * (3 - 2 * fa);
      for (let mi = 0; mi < NL; mi++) {
        const [b, fb] = pickStop(NAT_M, mi / (NL - 1));
        const sb = fb * fb * (3 - 2 * fb);
        for (let c = 0; c < 3; c++) {
          const v0 = FMM.lerp(table[a][b][c], table[a][b + 1][c], sb);
          const v1 = FMM.lerp(table[a + 1][b][c], table[a + 1][b + 1][c], sb);
          lut[(ti * NL + mi) * 3 + c] = Math.round(FMM.lerp(v0, v1, sa));
        }
      }
    }
    return lut;
  }
  const NAT_LUT = buildLut(NAT);
  const FAN_LUT = buildLut(FAN);
  const FT_WALD = [104, 138, 72], FT_TAIGA = [84, 112, 76], FT_REGEN = [86, 134, 62];
  const OCEAN_LUT = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const dpt = i / 255;
    let k = 0;
    while (k < OCEAN_STOPS.length - 2 && dpt > OCEAN_STOPS[k + 1][0]) k++;
    const f = (dpt - OCEAN_STOPS[k][0]) / (OCEAN_STOPS[k + 1][0] - OCEAN_STOPS[k][0]);
    for (let c = 0; c < 3; c++) OCEAN_LUT[i * 3 + c] = Math.round(FMM.lerp(OCEAN_STOPS[k][1][c], OCEAN_STOPS[k + 1][1][c], FMM.clamp(f, 0, 1)));
  }

  const STYLE = {
    geo: { river: '#3d76a6', riverAlpha: 0.85, text: '#1d1a16', halo: 'rgba(255,255,255,0.75)', sea: '#d8ecf5', seaHalo: 'rgba(20,50,80,0.55)', city: '#1d1a16', cityFill: '#ffffff', border: [120, 30, 30] },
    political: { river: '#4a80aa', riverAlpha: 0.9, text: '#2a221c', halo: 'rgba(250,246,236,0.85)', sea: '#356283', seaHalo: 'rgba(235,245,250,0.7)', city: '#2a221c', cityFill: '#ffffff', border: [70, 52, 48] },
    fantasy: { river: '#3a6a9a', riverAlpha: 0.85, text: '#2e2216', halo: 'rgba(246,240,220,0.8)', sea: '#eef4f4', seaHalo: 'rgba(24,44,84,0.55)', city: '#2e2216', cityFill: '#f6efdc', border: [110, 40, 34] },
    antique: { river: '#4f6878', riverAlpha: 0.9, text: '#3b2a18', halo: 'rgba(236,222,186,0.8)', sea: '#5a4a32', seaHalo: 'rgba(236,222,186,0.6)', city: '#3b2a18', cityFill: '#efe1bd', border: [120, 50, 40] },
  };
  FMM.STYLE = STYLE;

  // Schriftfarben für Landschafts- und Flussnamen je Stil
  const REGION_INK = {
    geo: { gebirge: '#3a2e22', wald: '#1f3a1c', wueste: '#5e3c1c', sumpf: '#2e3a26', see: '#1c3a5c', fluss: '#1c4a78' },
    fantasy: { gebirge: '#4a3826', wald: '#22401e', wueste: '#6e4220', sumpf: '#34402a', see: '#1f3f66', fluss: '#1f4f80' },
    political: { gebirge: '#4a3e34', wald: '#3e4a34', wueste: '#5e4a34', sumpf: '#3e4a3a', see: '#2c4a66', fluss: '#2c5478' },
    antique: { gebirge: '#3b2a18', wald: '#3b2a18', wueste: '#3b2a18', sumpf: '#3b2a18', see: '#3b2a18', fluss: '#3b2a18' },
  };

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
      const reliefAmt = L.relief ? (style === 'geo' ? 0.8 : style === 'political' ? 0.7 : style === 'fantasy' ? 0.38 : 0.9) : 0;
      const sty = style === 'geo' ? 0 : style === 'political' ? 1 : style === 'fantasy' ? 3 : 2;
      const maxShade = sty === 0 ? 1.25 : sty === 1 ? 1.15 : sty === 3 ? 1.08 : 1.12;
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


      // Fantasy: Landschaftsform je Zelle vorab bestimmen (Waldflächen werden weich daraus interpoliert)
      let forestK = null;
      if (sty === 3) {
        if (!this.forestK || this.forestK.length !== W * H) { this.forestK = new Float32Array(W * H); this.forestB = new Uint8Array(W * H); }
        forestK = this.forestK;
        const fb = this.forestB, R = 2;
        const bx0 = Math.max(0, cx0 - 2 - R), bx1 = Math.min(W, cx1 + 2 + R), by0 = Math.max(0, cy0 - 2 - R), by1 = Math.min(H, cy1 + 2 + R);
        for (let y = by0; y < by1; y++) {
          for (let x = bx0; x < bx1; x++) {
            const i = y * W + x, hv = h[i];
            if (hv < 0 || lake[i]) { biome[i] = 255; fb[i] = 0; continue; }
            const ov = bmap[i];
            const sl = Math.sqrt(gxC[i] * gxC[i] + gyC[i] * gyC[i]) * slopeK;
            const bi = ov !== 255 ? ov : FMM.classifyBiome(FMM.cellTemp(latT[y], hv), moist[i], hv, sl, rdist[i], veg[i], fine[i]);
            biome[i] = bi;
            fb[i] = forest[bi] ? 1 : 0;
          }
        }
        // Waldanteil der Umgebung (5×5, separierbar) → weiche Waldränder ohne Treppenstufen
        const fy0 = Math.max(0, cy0 - 2), fy1 = Math.min(H, cy1 + 2), fx0 = Math.max(0, cx0 - 2), fx1 = Math.min(W, cx1 + 2);
        for (let y = by0; y < by1; y++) {
          for (let x = fx0; x < fx1; x++) {
            let n = 0, c = 0;
            for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) { n += fb[y * W + xx]; c++; }
            forestK[y * W + x] = n / c;
          }
        }
        if (!this.forestT || this.forestT.length !== W * H) this.forestT = new Float32Array(W * H);
        const ft = this.forestT;
        for (let y = fy0; y < fy1; y++) {
          for (let x = fx0; x < fx1; x++) {
            let n = 0, c = 0;
            for (let yy = Math.max(by0, y - R); yy <= Math.min(by1 - 1, y + R); yy++) { n += forestK[yy * W + x]; c++; }
            ft[y * W + x] = n / c;
          }
        }
        forestK = ft;
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
            let dot = (nx * lx + ny * ly + lz) / len;
            // weiche Zusatzbeleuchtung aus Westen für natürlichere, weniger harte Schatten
            if (sty === 0 && !ocean) dot = dot * 0.72 + ((nx * -0.78 + 0.62) / len) * lz / 0.62 * 0.28;
            shade = 1 + (dot / lz - 1) * reliefAmt * (ocean ? (sty === 0 ? 0.35 : 0.6) : 1);
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
            } else if (sty === 3) {
              // Aquarell-Meer: tiefes Blau, zur Küste hin hell und türkis, wolkig gemalt
              const dd = FMM.smoothstep(0.03, 0.6, depth);
              r = 66 - dd * 34; g = 110 - dd * 50; b = 166 - dd * 46;
              const near = 1 - FMM.smoothstep(0, 16, cdi);
              const nf = near * near * 0.8;
              r += (154 - r) * nf; g += (198 - g) * nf; b += (208 - b) * nf;
              const pv = veg[i00] * w00 + veg[i10] * w10 + veg[i01] * w01 + veg[i11] * w11;
              const kw = 1 + paper[i] * 0.07 + pv * 0.05;
              r *= kw; g *= kw; b *= kw;
              if (lt < 0.06) { const f = FMM.smoothstep(0.06, -0.04, lt) * 0.8; r += (232 - r) * f; g += (240 - g) * f; b += (244 - b) * f; }
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
            if (sty === 0) { r = 50; g = 102; b = 142; }
            else if (sty === 1) { r = 150; g = 192; b = 214; }
            else if (sty === 3) { r = 92; g = 146; b = 186; }
            else { r = 180; g = 170; b = 140; }
          } else {
            const t = FMM.cellTemp(lt, hv);
            if (sty === 0) {
              const slope = Math.sqrt(gx * gx + gy * gy) * slopeK;
              const v = veg[i00] * w00 + veg[i10] * w10 + veg[i01] * w01 + veg[i11] * w11;
              const fn = fine[i00] * w00 + fine[i10] * w10 + fine[i01] * w01 + fine[i11] * w11;
              const rdi = rdist[i00] * w00 + rdist[i10] * w10 + rdist[i01] * w01 + rdist[i11] * w11;
              const ov = bmap[i];
              const mI = moist[i00] * w00 + moist[i10] * w10 + moist[i01] * w01 + moist[i11] * w11;
              // Landschaftstyp (für Legende, Anzeige und Symbole)
              const bi = ov !== 255 ? ov : FMM.classifyBiome(t, mI, hv, slope, rdi, v, fn);
              biome[i] = bi;
              const treeline = 0.46 + v * 0.05;
              let canopy;
              if (ov !== 255) {
                // von Hand gemalte Landschaft: deren Farbe, aber gleiche natürliche Struktur
                const c = FMM.BIOMES[ov].color;
                r = c[0]; g = c[1]; b = c[2];
                canopy = forest[ov] ? 1 : 0;
              } else {
                // natürliche Farbe stufenlos aus Temperatur und Feuchte (Flusstäler etwas grüner)
                const wet = FMM.clamp(mI + v * 0.12 + (rdi < 6 ? (6 - rdi) * 0.03 : 0), 0, 1);
                const ti = FMM.clamp(((t + 0.1) / 1.05) * (NL - 1), 0, NL - 1) | 0;
                const k = (ti * NL + ((wet * (NL - 1)) | 0)) * 3;
                r = NAT_LUT[k]; g = NAT_LUT[k + 1]; b = NAT_LUT[k + 2];
                // Walddichte als gleitender Wert: feucht genug, warm genug, unter der Baumgrenze
                canopy = FMM.smoothstep(0.5, 0.78, wet + fn * 0.04) * FMM.smoothstep(0.12, 0.3, t) *
                  (1 - FMM.smoothstep(treeline - 0.06, treeline + 0.04, hv));
                // Trockengebiete: Sandtöne mit leichten Dünen
                const dry = FMM.smoothstep(0.3, 0.12, wet) * FMM.smoothstep(0.5, 0.72, t);
                if (dry > 0) { const kd = 1 + 0.045 * dry * Math.sin(fx * 0.55 + fy * 0.2 + v * 18); r *= kd; g *= kd; b *= kd; }
                // Feuchtgebiete in flachen Niederungen
                if (hv < 0.07 && slope < 0.25 && wet > 0.78 && t > 0.3) {
                  const f = FMM.smoothstep(0.78, 0.95, wet) * (1 - hv / 0.07) * 0.6;
                  r += (84 - r) * f; g += (98 - g) * f; b += (72 - b) * f;
                  if (fn > 0.35) { r += (72 - r) * f * 0.8; g += (106 - g) * f * 0.8; b += (118 - b) * f * 0.8; }
                }
                // Polareis
                const ice = FMM.smoothstep(-0.02, -0.1, t + v * 0.02);
                if (ice > 0) { r += (232 - r) * ice; g += (236 - g) * ice; b += (240 - b) * ice; }
              }
              // Kronendach: dunkler, mit feiner, weicher Struktur
              if (canopy > 0) {
                const k = 1 - canopy * (0.16 + 0.14 * (fn * 0.5 + 0.5));
                r *= k * 0.96; g *= k * 1.02; b *= k * 0.96;
              } else {
                const k = 0.97 + v * 0.04 + fn * 0.02;
                r *= k; g *= k; b *= k;
              }
              // Hochlagen: oberhalb der Baumgrenze alpine Matten, darüber und an Steilhängen Fels
              const alp = FMM.smoothstep(treeline - 0.03, treeline + 0.1, hv);
              if (alp > 0) { const f = alp * 0.55; r += (140 - r) * f; g += (138 - g) * f; b += (106 - b) * f; }
              const rock = Math.max(FMM.smoothstep(0.58, 0.82, hv + v * 0.04), FMM.smoothstep(1.0, 1.9, slope) * FMM.smoothstep(0.28, 0.45, hv));
              if (rock > 0) {
                // Gesteinsschichten nur angedeutet – stärker wirken sie an Steilhängen wie Höhenlinien
                const kr = 0.93 + fn * 0.06 + 0.012 * Math.sin(hv * 60 + v * 6);
                const f = rock * 0.85;
                r += (128 * kr - r) * f; g += (119 * kr - g) * f; b += (106 * kr - b) * f;
              }
              // Schneegrenze abhängig vom Breitengrad: im Kalten tiefer, im Warmen höher.
              // Grate (positive Krümmung) tragen etwas mehr Schnee, Täler weniger – begrenzt, damit
              // keine hellen Linien entlang von Geländekanten entstehen. Breiter, fleckiger Übergang.
              const snowLine = FMM.clamp(0.58 + (lt - 0.3) * 0.7, 0.36, 0.95);
              const snow = ov !== 255 && ov !== BI.fels ? 0
                : FMM.smoothstep(snowLine, snowLine + 0.2, hv + FMM.clamp(cv, -0.05, 0.05) * 2 + v * 0.04 + fn * 0.025);
              if (snow > 0) {
                r += (232 - r) * snow; g += (236 - g) * snow; b += (242 - b) * snow;
                // Licht auf Schnee nicht übersteuern, sonst wirkt er wie eine flache weiße Fläche
                if (shade > 1) shade = 1 + (shade - 1) * (1 - 0.5 * snow);
              }
              // Küsten: Steilküste mit dunklen Klippen, flache Küste mit Sandstrand
              const cdl = cd[i00] * w00 + cd[i10] * w10 + cd[i01] * w01 + cd[i11] * w11;
              if (cdl < 2.5 && slope > 0.5) {
                const f = FMM.smoothstep(0.5, 1.2, slope) * (1 - cdl / 2.5) * 0.75;
                r += (100 - r) * f; g += (92 - g) * f; b += (84 - b) * f;
              } else if (hv < 0.022 && t > 0.28 && slope < 0.5) {
                const f = ((0.022 - hv) / 0.022) * 0.75 * (1 - slope / 0.5);
                r += (222 - r) * f; g += (207 - g) * f; b += (166 - b) * f;
              }
            } else if (sty === 3) {
              const v = veg[i00] * w00 + veg[i10] * w10 + veg[i01] * w01 + veg[i11] * w11;
              const fn = fine[i00] * w00 + fine[i10] * w10 + fine[i01] * w01 + fine[i11] * w11;
              const rdi = rdist[i00] * w00 + rdist[i10] * w10 + rdist[i01] * w01 + rdist[i11] * w11;
              const mI = moist[i00] * w00 + moist[i10] * w10 + moist[i01] * w01 + moist[i11] * w11;
              const ov = bmap[i];
              const bi = biome[i];
              // Grundton aus Temperatur und Feuchte
              const wet = FMM.clamp(mI + v * 0.12 + (rdi < 6 ? (6 - rdi) * 0.03 : 0), 0, 1);
              const ti = FMM.clamp(((t + 0.1) / 1.05) * (NL - 1), 0, NL - 1) | 0;
              const k = (ti * NL + ((wet * (NL - 1)) | 0)) * 3;
              r = FAN_LUT[k]; g = FAN_LUT[k + 1]; b = FAN_LUT[k + 2];
              if (ov !== 255) {
                // gemalte Landschaft: deren Farbe, aufgehellt wie Aquarell
                const c = FMM.BIOMES[ov].color;
                r += (c[0] * 0.6 + 96 - r) * 0.7; g += (c[1] * 0.6 + 96 - g) * 0.7; b += (c[2] * 0.6 + 90 - b) * 0.7;
              }
              // Waldflächen: dunkelgrüne Lasur mit weichem, aber klarem Rand
              const fk = forestK[i00] * w00 + forestK[i10] * w10 + forestK[i01] * w01 + forestK[i11] * w11;
              const fa = FMM.smoothstep(0.3, 0.6, fk + fn * 0.06 + v * 0.05) * 0.6;
              if (fa > 0) {
                const fc = bi === BI.taiga ? FT_TAIGA : bi === BI.regenwald ? FT_REGEN : FT_WALD;
                r += (fc[0] - r) * fa; g += (fc[1] - g) * fa; b += (fc[2] - b) * fa;
              }
              if (bi === BI.sumpf) { r += (150 - r) * 0.45; g += (160 - g) * 0.45; b += (118 - b) * 0.45; }
              // Hochlagen graubraun, Gipfel über der Schneegrenze hell
              const alp = FMM.smoothstep(0.42, 0.66, hv + v * 0.03);
              if (alp > 0) { const f = alp * 0.6; r += (184 - r) * f; g += (174 - g) * f; b += (150 - b) * f; }
              const snowLine = FMM.clamp(0.58 + (lt - 0.3) * 0.7, 0.36, 0.95);
              const snow = FMM.smoothstep(snowLine, snowLine + 0.18, hv + v * 0.04) * 0.7;
              if (snow > 0) { r += (236 - r) * snow; g += (238 - g) * snow; b += (238 - b) * snow; }
              const ice = FMM.smoothstep(-0.02, -0.1, t + v * 0.02);
              if (ice > 0) { r += (240 - r) * ice; g += (242 - g) * ice; b += (240 - b) * ice; }
              // Aquarell: ungleichmäßiger Farbauftrag, dunklerer Pigmentrand an der Küste
              const cdl = cd[i00] * w00 + cd[i10] * w10 + cd[i01] * w01 + cd[i11] * w11;
              let kw = 1 + paper[i] * 0.06 + v * 0.035 + fn * 0.012;
              if (cdl < 3) kw -= (3 - cdl) / 3 * 0.09;
              r *= kw; g *= kw; b *= kw;
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
          const grain = (FMM.hash2(X, Y) - 0.5) * (sty === 0 ? 3 : sty === 3 ? 5 : 8);
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
          // dezente Brandungslinie statt harter Kontur
          ctx.strokeStyle = 'rgba(228,244,242,0.28)';
          ctx.lineWidth = 2 * unit;
          ctx.stroke(cc.coast);
          ctx.strokeStyle = 'rgba(30,52,60,0.32)';
          ctx.lineWidth = 0.6 * unit;
          ctx.stroke(cc.coast);
          ctx.strokeStyle = 'rgba(30,52,60,0.3)';
          ctx.lineWidth = 0.6 * unit;
          ctx.stroke(cc.lakes);
        } else if (sty === 'fantasy') {
          // heller Brandungssaum und feine Tuschelinie
          ctx.strokeStyle = 'rgba(232,244,240,0.45)';
          ctx.lineWidth = 2.6 * unit;
          ctx.stroke(cc.coast);
          ctx.strokeStyle = 'rgba(46,56,62,0.8)';
          ctx.lineWidth = 0.75 * unit;
          ctx.stroke(cc.coast);
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
          ctx.lineWidth = rc.widths[k] * (map.view.style === 'geo' ? 1.1 : 1);
          ctx.stroke(rc.buckets[k]);
        }
        ctx.globalAlpha = 1;
      }

      // gezeichnete Symbole (Berge, Hügel, Bäume)
      if (L.symbols && this.live !== 'terrain') {
        if (!this.symbolCache || this.symbolCache.style !== sty) this.symbolCache = FMM.buildSymbols(map, d, this);
        FMM.drawSymbols(ctx, this.symbolCache, sty, unit);
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
          if (lb.path && lb.path.length >= 4) {
            // Landschafts- und Flussnamen folgen ihrem Pfad
            const sub = lb.kind === 'river' ? 'fluss' : lb.sub;
            const ink = (REGION_INK[sty] || REGION_INK.geo)[sub] || st.text;
            const caps = sub === 'gebirge';
            const box = this.drawTextOnPath(ctx, lb.text, lb.path, {
              font: `${caps ? '600 ' : 'italic '}${size}px ${caps ? FONT_LABEL : FONT_TEXT}`,
              color: lb.color || ink,
              halo: st.halo,
              haloWidth: size * 0.15,
              spacing: size * (caps ? 0.35 : sub === 'fluss' || sub === 'see' ? 0.1 : 0.2),
              alpha: 0.9,
            });
            this.hitBoxes.push({ type: 'label', id: lb.id, ...box });
            if (opts.selection && opts.selection.type === 'label' && opts.selection.id === lb.id) this.drawSelBox(ctx, box, view);
            continue;
          }
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

    // Text entlang einer Polylinie [x0, y0, x1, y1, …]; Buchstaben einzeln nach der Tangente gedreht
    drawTextOnPath(ctx, text, path, o) {
      let p = path;
      // Schrift nie kopfüber: Pfad von links nach rechts lesen
      if (p[p.length - 2] < p[0]) { const q = []; for (let k = p.length - 2; k >= 0; k -= 2) q.push(p[k], p[k + 1]); p = q; }
      p = chaikin2(chaikin2(p));
      const n = p.length / 2, cum = [0];
      for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]));
      const L = cum[n - 1];
      // Punkt auf dem Pfad bei Bogenlänge s (außerhalb: geradlinig verlängert)
      const at = (sv) => {
        let k = 1;
        while (k < n - 1 && cum[k] < sv) k++;
        const seg = (cum[k] - cum[k - 1]) || 1;
        const f = (sv - cum[k - 1]) / seg;
        return [p[2 * k - 2] + (p[2 * k] - p[2 * k - 2]) * f, p[2 * k - 1] + (p[2 * k + 1] - p[2 * k - 1]) * f];
      };
      ctx.save();
      ctx.font = o.font;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      const chars = [...text];
      const sp = o.spacing || 0;
      const ws = chars.map((ch) => ctx.measureText(ch).width);
      const total = ws.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
      const size = parseFloat(/(\d+(\.\d+)?)px/.exec(o.font)[1]);
      let sPos = (L - total) / 2;
      const place = [];
      for (let k = 0; k < chars.length; k++) {
        const c = sPos + ws[k] / 2;
        const d = Math.max(ws[k] / 2, size * 0.3);
        const a = at(c - d), b = at(c + d), m = at(c);
        place.push([m[0], m[1], Math.atan2(b[1] - a[1], b[0] - a[0])]);
        sPos += ws[k] + sp;
      }
      const base = ctx.getTransform();
      const pass = (stroke) => {
        for (let k = 0; k < chars.length; k++) {
          if (chars[k] === ' ') continue;
          const [x, y, ang] = place[k];
          ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
          ctx.translate(x, y);
          ctx.rotate(ang);
          if (stroke) ctx.strokeText(chars[k], 0, 0); else ctx.fillText(chars[k], 0, 0);
        }
      };
      if (o.halo) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = o.haloWidth || 3;
        ctx.strokeStyle = o.halo;
        pass(true);
      }
      ctx.fillStyle = o.color;
      pass(false);
      ctx.restore();
      const mid = at(L / 2), a0 = at(L / 2 - total / 4), a1 = at(L / 2 + total / 4);
      return { x: mid[0], y: mid[1], w: total, h: size * 1.3, angle: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) };
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

  // Chaikin-Glättung für Punktpaare [x, y, …]; Endpunkte bleiben
  function chaikin2(p) {
    const n = p.length / 2;
    if (n < 3) return p;
    const out = [p[0], p[1]];
    for (let k = 0; k < n - 1; k++) {
      const a = 2 * k, b = a + 2;
      out.push(p[a] * 0.75 + p[b] * 0.25, p[a + 1] * 0.75 + p[b + 1] * 0.25, p[a] * 0.25 + p[b] * 0.75, p[a + 1] * 0.25 + p[b + 1] * 0.75);
    }
    out.push(p[2 * n - 2], p[2 * n - 1]);
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
