/* Niederschlag aus Wind: feuchte Luft zieht vom Meer über das Land, regnet sich an
   Gebirgen ab (Luvseite) und hinterlässt dahinter trockene Gebiete (Regenschatten). */
(function () {
  'use strict';
  const FMM = window.FMM;

  FMM.WINDS = {
    auto: 'Automatisch (nach Klimazone)',
    west: 'Westwind',
    ost: 'Ostwind',
    nord: 'Nordwind',
    sued: 'Südwind',
  };

  // Anteil des Passats (Ostwind) nach Breite: Westwinde in kühlen/mittleren Breiten, Passat in warmen.
  // Kein harter Wechsel – beide Windsysteme gehen über einen breiten Gürtel ineinander über.
  function tradeShare(latT) {
    return FMM.smoothstep(0.5, 0.74, latT);
  }

  // Version der Niederschlagsberechnung; ältere gespeicherte Karten werden beim Laden neu berechnet
  FMM.MOISTURE_VERSION = 2;

  FMM.computeMoisture = function (map) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const latT = FMM.Derive.latitudeTemps(map);
    const setting = map.settings.wind || 'auto';
    map.settings.moistureV = FMM.MOISTURE_VERSION;
    const precip = new Float32Array(N);
    const noise = FMM.createNoise2D(FMM.makeRng((map.settings.seed || 'welt') + 'feuchte'));

    // Luftpaket entlang einer Linie von Zellen (in Windrichtung) führen; wt: Gewicht pro Zelle
    const march = (cells, warmth, wt) => {
      let q = 0.9; // Luftfeuchte
      let prev = 0;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const v = h[i];
        if (v < 0) {
          // über dem Meer: Verdunstung füllt die Luft wieder auf (warmes Meer schneller)
          q += (1 - q) * (0.04 + 0.06 * warmth);
          prev = 0;
          continue;
        }
        const lift = Math.max(0, v - prev); // Aufstieg am Hang → Steigungsregen
        let rain = q * (0.008 + lift * 2.6 + v * 0.004);
        if (rain > q) rain = q;
        q -= rain;
        precip[i] += rain * (wt ? wt[k] : 1);
        q += rain * 0.55; // Verdunstung über Land (Pflanzen, Böden)
        if (q > 1) q = 1;
        prev = v;
      }
    };

    const line = [];
    const wt = new Float32Array(Math.max(W, H));
    for (let y = 0; y < H; y++) {
      const warmth = FMM.clamp(latT[y], 0, 1);
      if (setting === 'auto') {
        // Grenze der Windgürtel leicht gewellt statt entlang eines Breitengrades
        const share = (x) => tradeShare(latT[y] + FMM.fbm(noise, x / H * 3 + 50, y / H * 3, 3, 2, 0.5) * 0.08);
        line.length = 0;
        for (let x = 0; x < W; x++) { line.push(y * W + x); wt[x] = 1 - share(x); }
        march(line, warmth, wt);
        line.length = 0;
        for (let x = 0; x < W; x++) { line.push(y * W + W - 1 - x); wt[x] = share(W - 1 - x); }
        march(line, warmth, wt);
      } else if (setting === 'west' || setting === 'ost') {
        line.length = 0;
        for (let x = 0; x < W; x++) line.push(y * W + (setting === 'west' ? x : W - 1 - x));
        march(line, warmth);
      }
    }
    if (setting === 'nord' || setting === 'sued') {
      for (let x = 0; x < W; x++) {
        line.length = 0;
        for (let y = 0; y < H; y++) line.push((setting === 'nord' ? y : H - 1 - y) * W + x);
        march(line, 0.5);
      }
    }

    // Glätten (Luftmassen sind breiter als eine Zeile); drei Durchgänge ≈ Gaußfilter ohne Kanten
    const br = Math.max(3, Math.round(5 * Math.min(W, H) / 750));
    boxBlur(precip, W, H, br);
    boxBlur(precip, W, H, br);
    boxBlur(precip, W, H, br);

    // normieren an der feuchten Landfläche
    const vals = [];
    const step = Math.max(1, Math.floor(N / 50000));
    for (let i = 0; i < N; i += step) if (h[i] >= 0) vals.push(precip[i]);
    vals.sort((a, b) => a - b);
    const ref = vals.length ? vals[Math.floor(vals.length * 0.9)] || 1e-6 : 1;

    // etwas großräumige Variation, damit es nicht zu gleichförmig wirkt
    const m = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const n = FMM.fbm(noise, (x / H) * 2.6, (y / H) * 2.6, 4, 2, 0.5);
        const p = Math.pow(FMM.clamp(precip[i] / ref, 0, 1.3), 0.8);
        m[i] = h[i] < 0 ? 0.8 : FMM.clamp(p * 0.8 + n * 0.18 + 0.1, 0, 1);
      }
    }
    return m;
  };

  function boxBlur(a, W, H, r) {
    const tmp = new Float32Array(a.length);
    const n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + FMM.clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = acc / n;
        acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[FMM.clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / n;
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
  }
})();
