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

  // Anteil der Ostwinde nach Breite (Grad): Passat bis ~30°, Westwinde bis ~60°, polare Ostwinde darüber.
  // Kein harter Wechsel – die Windsysteme gehen über breite Gürtel ineinander über.
  function eastShare(lat) {
    const a = Math.abs(lat);
    return 1 - FMM.smoothstep(24, 36, a) + FMM.smoothstep(56, 66, a);
  }

  // Niederschlag nach globaler Zirkulation: feuchte innertropische Konvergenzzone, trockenes
  // Subtropenhoch (Wüstengürtel um 25°), feuchte Westwindfronten, trockene Polargebiete
  function circulation(lat) {
    const a = Math.abs(lat);
    const g = (c, w) => Math.exp(-((a - c) / w) * ((a - c) / w));
    return 1 + 0.45 * g(0, 9) - 0.6 * g(26, 8) + 0.15 * g(52, 10) - 0.45 * FMM.smoothstep(62, 80, a);
  }
  FMM.circulation = circulation;

  // Version der Niederschlagsberechnung; ältere gespeicherte Karten werden beim Laden neu berechnet
  FMM.MOISTURE_VERSION = 3;

  FMM.computeMoisture = function (map) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const latT = FMM.Derive.latitudeTemps(map);
    const lat = FMM.Derive.latitudes(map);
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
        // Rückverdunstung über Land (Pflanzen, Böden): in den Tropen stark (Regenwald hält sich selbst feucht),
        // in kühlen Breiten schwächer → trockenes Inland großer Kontinente
        q += rain * (0.42 + 0.45 * warmth);
        if (q > 1) q = 1;
        prev = v;
      }
    };

    const line = [];
    const wt = new Float32Array(Math.max(W, H));
    const share = new Float32Array(W);
    for (let y = 0; y < H; y++) {
      const warmth = FMM.clamp(latT[y], 0, 1);
      if (setting === 'auto') {
        // Grenze der Windgürtel leicht gewellt (±4°) statt entlang eines Breitengrades; Rauschen grob abgetastet
        for (let x = 0; x < W; x += 8) {
          const v = eastShare(lat[y] + FMM.fbm(noise, x / H * 3 + 50, y / H * 3, 3, 2, 0.5) * 8);
          for (let k = 0; k < 8 && x + k < W; k++) share[x + k] = v;
        }
        for (let x = 0; x < W - 8; x += 8) {
          const a = share[x], b = share[x + 8];
          for (let k = 1; k < 8; k++) share[x + k] = a + ((b - a) * k) / 8;
        }
        line.length = 0;
        for (let x = 0; x < W; x++) { line.push(y * W + x); wt[x] = 1 - share[x]; }
        march(line, warmth, wt);
        line.length = 0;
        for (let x = 0; x < W; x++) { line.push(y * W + W - 1 - x); wt[x] = share[W - 1 - x]; }
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

    // globale Zirkulation: Regen je Breitengürtel verstärken bzw. unterdrücken
    for (let y = 0; y < H; y++) {
      const c = circulation(lat[y]);
      for (let x = 0, i = y * W; x < W; x++, i++) precip[i] *= c;
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
