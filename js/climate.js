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

  // Hauptwindrichtung einer Zeile: Westwinde in kühlen/mittleren Breiten, Passat aus Osten in warmen
  function autoWind(latT) {
    return latT < 0.62 ? 'west' : 'ost';
  }

  FMM.computeMoisture = function (map) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const latT = FMM.Derive.latitudeTemps(map);
    const setting = map.settings.wind || 'auto';
    const precip = new Float32Array(N);

    // Luftpaket entlang einer Linie von Zellen (in Windrichtung) führen
    const march = (cells, warmth) => {
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
        precip[i] += rain;
        q += rain * 0.55; // Verdunstung über Land (Pflanzen, Böden)
        if (q > 1) q = 1;
        prev = v;
      }
    };

    const line = [];
    for (let y = 0; y < H; y++) {
      const dir = setting === 'auto' ? autoWind(latT[y]) : setting;
      if (dir !== 'west' && dir !== 'ost') continue;
      line.length = 0;
      for (let x = 0; x < W; x++) line.push(y * W + (dir === 'west' ? x : W - 1 - x));
      march(line, FMM.clamp(latT[y], 0, 1));
    }
    if (setting === 'nord' || setting === 'sued') {
      for (let x = 0; x < W; x++) {
        line.length = 0;
        for (let y = 0; y < H; y++) line.push((setting === 'nord' ? y : H - 1 - y) * W + x);
        march(line, 0.5);
      }
    }

    // Glätten (Luftmassen sind breiter als eine Zeile)
    boxBlur(precip, W, H, 4);
    boxBlur(precip, W, H, 4);

    // normieren an der feuchten Landfläche
    const vals = [];
    const step = Math.max(1, Math.floor(N / 50000));
    for (let i = 0; i < N; i += step) if (h[i] >= 0) vals.push(precip[i]);
    vals.sort((a, b) => a - b);
    const ref = vals.length ? vals[Math.floor(vals.length * 0.9)] || 1e-6 : 1;

    // etwas großräumige Variation, damit es nicht zu gleichförmig wirkt
    const noise = FMM.createNoise2D(FMM.makeRng((map.settings.seed || 'welt') + 'feuchte'));
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
