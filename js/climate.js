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
  FMM.MOISTURE_VERSION = 4;

  // ---------- Meeresströmungen ----------
  // Vereinfachte Ozeanwirbel: Am Westrand eines Ozeans (Ostküsten der Kontinente) fließt warmes Wasser
  // polwärts (Golfstrom), in hohen Breiten kaltes äquatorwärts (Labradorstrom). Am Ostrand des Ozeans
  // (Westküsten der Kontinente) fließt in den Subtropen kaltes Wasser äquatorwärts (Humboldtstrom → Küstenwüsten),
  // in hohen Breiten warmes polwärts (Nordatlantikstrom → milde Küsten). Dazu Passat- und Westwinddrift.
  // Ergebnis auf grobem Raster: Strömungsvektor (u, v), Meerestemperatur-Abweichung und Abweichung an Land.
  FMM.computeCurrents = function (map) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const G = Math.max(2, Math.round(4 * unit));
    const gw = Math.ceil(W / G), gh = Math.ceil(H / G), GN = gw * gh;
    const lat = FMM.Derive.latitudes(map);
    const land = new Uint8Array(GN);
    for (let gy = 0; gy < gh; gy++) {
      const y = Math.min(H - 1, gy * G + (G >> 1));
      for (let gx = 0; gx < gw; gx++) land[gy * gw + gx] = h[y * W + Math.min(W - 1, gx * G + (G >> 1))] >= 0 ? 1 : 0;
    }
    // Abstand zur Küste (in groben Zellen), beidseitig, und nächste Meereszelle für Landzellen
    const dist = new Uint16Array(GN).fill(65535);
    const src = new Int32Array(GN).fill(-1);
    const q = new Int32Array(GN);
    let qh = 0, qt = 0;
    for (let i = 0; i < GN; i++) {
      const x = i % gw, y = (i / gw) | 0;
      let edge = false;
      for (const [dx, dy] of FMM.N4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && land[ny * gw + nx] !== land[i]) { edge = true; break; }
      }
      if (edge) { dist[i] = 0; src[i] = land[i] ? -1 : i; q[qt++] = i; }
    }
    // Landzellen am Rand bekommen ihre Meereszelle aus der Nachbarschaft
    for (let k = 0; k < qt; k++) {
      const i = q[k];
      if (!land[i]) continue;
      const x = i % gw, y = (i / gw) | 0;
      for (const [dx, dy] of FMM.N4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && !land[ny * gw + nx]) { src[i] = ny * gw + nx; break; }
      }
    }
    while (qh < qt) {
      const c = q[qh++];
      const x = c % gw, y = (c / gw) | 0;
      for (const [dx, dy] of FMM.N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx;
        if (dist[n] !== 65535 || land[n] !== land[c]) continue;
        dist[n] = dist[c] + 1;
        src[n] = src[c];
        q[qt++] = n;
      }
    }

    // Abstand zum nächsten Land nach Westen und Osten je Zeile (Ozeanränder)
    const dW = new Float32Array(GN), dE = new Float32Array(GN);
    for (let gy = 0; gy < gh; gy++) {
      let last = -1;
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        if (land[i]) last = gx;
        dW[i] = last < 0 ? Infinity : (gx - last) * G;
      }
      last = -1;
      for (let gx = gw - 1; gx >= 0; gx--) {
        const i = gy * gw + gx;
        if (land[i]) last = gx;
        dE[i] = last < 0 ? Infinity : (last - gx) * G;
      }
    }
    const L = W * 0.1;
    const u = new Float32Array(GN), v = new Float32Array(GN), sst = new Float32Array(GN);
    for (let gy = 0; gy < gh; gy++) {
      const la = lat[Math.min(H - 1, gy * G)], a = Math.abs(la);
      const pole = la >= 0 ? -1 : 1; // Richtung zum Pol in Bildkoordinaten (Norden = oben)
      const merWB = 1 - 2 * FMM.smoothstep(38, 50, a); // Westrand: polwärts in den Subtropen, äquatorwärts darüber
      const merEB = -0.75 * (1 - 2 * FMM.smoothstep(36, 46, a)); // Ostrand: umgekehrt
      const zonal = -(1 - FMM.smoothstep(16, 30, a)) + FMM.smoothstep(30, 42, a) * (1 - FMM.smoothstep(58, 68, a)) - 0.5 * FMM.smoothstep(62, 72, a);
      const tempK = FMM.smoothstep(6, 18, a) * (1 - FMM.smoothstep(70, 84, a));
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        if (land[i]) continue;
        const wb = Math.exp(-dW[i] / L), eb = Math.exp(-dE[i] / L);
        const mer = wb * merWB + eb * merEB;
        u[i] = zonal * (1 - Math.min(1, wb + eb) * 0.75);
        v[i] = pole * mer;
        // polwärts fließendes Wasser bringt Wärme, äquatorwärts fließendes Kälte
        sst[i] = 0.1 * mer * tempK;
      }
    }
    // Strömung an der Küste entlangführen: Anteil Richtung Land entfernen
    for (let i = 0; i < GN; i++) {
      if (land[i] || dist[i] > 3) continue;
      const x = i % gw, y = (i / gw) | 0;
      const dd = (xx, yy) => (xx < 0 || yy < 0 || xx >= gw || yy >= gh ? dist[i] + 1 : land[yy * gw + xx] ? 0 : dist[yy * gw + xx]);
      let nx = dd(x + 1, y) - dd(x - 1, y), ny = dd(x, y + 1) - dd(x, y - 1);
      const nl = Math.hypot(nx, ny);
      if (nl < 1e-6) continue;
      nx /= nl; ny /= nl; // zeigt vom Land weg
      const dot = u[i] * nx + v[i] * ny;
      if (dot < 0) { u[i] -= dot * nx; v[i] -= dot * ny; }
    }
    // Meerestemperatur glätten (nur Meereszellen mitteln)
    const sm = smoothMasked(sst, land, gw, gh, 3);
    // Land: Einfluss der nächsten Meereszelle, nimmt landeinwärts ab
    const Lland = (30 * unit) / G;
    const field = new Float32Array(GN);
    for (let i = 0; i < GN; i++) {
      if (!land[i]) field[i] = sm[i];
      else field[i] = src[i] >= 0 ? sm[src[i]] * Math.exp(-dist[i] / Lland) : 0;
    }
    return { G, gw, gh, u, v, sst: sm, field, land, dist };
  };

  // Temperatur-Abweichung je Kartenzelle (bilinear aus dem groben Raster)
  FMM.currentTempField = function (map, cur) {
    const W = map.width, H = map.height, out = new Float32Array(W * H);
    const { G, gw, gh, field } = cur;
    for (let y = 0; y < H; y++) {
      const fy = FMM.clamp((y + 0.5) / G - 0.5, 0, gh - 1), iy = fy | 0, ty = fy - iy, iy1 = Math.min(gh - 1, iy + 1);
      for (let x = 0; x < W; x++) {
        const fx = FMM.clamp((x + 0.5) / G - 0.5, 0, gw - 1), ix = fx | 0, tx = fx - ix, ix1 = Math.min(gw - 1, ix + 1);
        const a = field[iy * gw + ix] + (field[iy * gw + ix1] - field[iy * gw + ix]) * tx;
        const b = field[iy1 * gw + ix] + (field[iy1 * gw + ix1] - field[iy1 * gw + ix]) * tx;
        out[y * W + x] = a + (b - a) * ty;
      }
    }
    return out;
  };

  // Strömungspfeile: Stromlinien von verteilten Startpunkten, ohne sich zu überlagern
  FMM.buildCurrentArrows = function (map, cur) {
    const W = map.width, H = map.height;
    const unit = Math.min(W, H) / 750;
    const { G, gw, gh, u, v, sst, land, dist } = cur;
    const at = (arr, x, y) => {
      const fx = FMM.clamp(x / G - 0.5, 0, gw - 1), fy = FMM.clamp(y / G - 0.5, 0, gh - 1);
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, ix1 = Math.min(gw - 1, ix + 1), iy1 = Math.min(gh - 1, iy + 1);
      const a = arr[iy * gw + ix] + (arr[iy * gw + ix1] - arr[iy * gw + ix]) * tx;
      const b = arr[iy1 * gw + ix] + (arr[iy1 * gw + ix1] - arr[iy1 * gw + ix]) * tx;
      return a + (b - a) * ty;
    };
    const cellOf = (x, y) => FMM.clamp((y / G) | 0, 0, gh - 1) * gw + FMM.clamp((x / G) | 0, 0, gw - 1);
    const occS = 14 * unit, ow = Math.ceil(W / occS), oh = Math.ceil(H / occS);
    const occ = new Int32Array(ow * oh).fill(-1);
    const oc = (x, y) => FMM.clamp((y / occS) | 0, 0, oh - 1) * ow + FMM.clamp((x / occS) | 0, 0, ow - 1);
    const out = [];
    const sp = 64 * unit, step = 2.2 * unit;
    for (let sy = sp * 0.5; sy < H; sy += sp) {
      for (let sx = sp * 0.5; sx < W; sx += sp) {
        let x = sx + (FMM.hash2(sx | 0, sy | 0) - 0.5) * sp * 0.6;
        let y = sy + (FMM.hash2(sy | 0, (sx | 0) + 7) - 0.5) * sp * 0.6;
        const c0 = cellOf(x, y);
        if (land[c0] || dist[c0] < 2 || occ[oc(x, y)] >= 0) continue;
        const id = out.length;
        const pts = [x, y];
        let tsum = 0, n = 0;
        for (let k = 0; k < 44; k++) {
          const uu = at(u, x, y), vv = at(v, x, y), sp2 = Math.hypot(uu, vv);
          if (sp2 < 0.18) break;
          const nx = x + (uu / sp2) * step, ny = y + (vv / sp2) * step;
          if (nx < 4 * unit || ny < 4 * unit || nx > W - 4 * unit || ny > H - 4 * unit) break;
          const c = cellOf(nx, ny);
          if (land[c] || dist[c] < 1) break;
          const o = occ[oc(nx, ny)];
          if (o >= 0 && o !== id) break;
          x = nx; y = ny;
          pts.push(x, y);
          tsum += at(sst, x, y); n++;
        }
        if (pts.length < 28) continue;
        for (let k = 0; k < pts.length; k += 2) occ[oc(pts[k], pts[k + 1])] = id;
        out.push({ pts, t: n ? tsum / n : 0 });
      }
    }
    return out;
  };

  function smoothMasked(a, land, w, h, r) {
    let cur = a;
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(a.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (land[i]) continue;
          let s = 0, n = 0;
          for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
            for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
              const j = yy * w + xx;
              if (!land[j]) { s += cur[j]; n++; }
            }
          }
          out[i] = s / n;
        }
      }
      cur = out;
    }
    return cur;
  }

  FMM.computeMoisture = function (map) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const latT = FMM.Derive.latitudeTemps(map);
    const lat = FMM.Derive.latitudes(map);
    const setting = map.settings.wind || 'auto';
    map.settings.moistureV = FMM.MOISTURE_VERSION;
    const precip = new Float32Array(N);
    const noise = FMM.createNoise2D(FMM.makeRng((map.settings.seed || 'welt') + 'feuchte'));
    // Meeresströmungen: warmes Wasser verdunstet mehr, kalte Auftriebsküsten bleiben trocken
    const tA = FMM.currentTempField(map, FMM.computeCurrents(map));

    // Luftpaket entlang einer Linie von Zellen (in Windrichtung) führen; wt: Gewicht pro Zelle
    const march = (cells, warmth, wt) => {
      let q = 0.9; // Luftfeuchte
      let prev = 0;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const v = h[i];
        if (v < 0) {
          // über dem Meer: Verdunstung füllt die Luft wieder auf (warmes Meer schneller)
          q += (1 - q) * (0.04 + 0.06 * warmth) * FMM.clamp(1 + 8 * tA[i], 0.25, 1.8);
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
      for (let x = 0, i = y * W; x < W; x++, i++) precip[i] *= c * (h[i] >= 0 ? FMM.clamp(1 + 5 * tA[i], 0.4, 1.4) : 1);
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
