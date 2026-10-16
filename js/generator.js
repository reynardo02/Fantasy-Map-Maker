/* Prozedurale Kartengenerierung: Gelände, Feuchtigkeit, Staaten, Städte, Meeresnamen */
(function () {
  'use strict';
  const FMM = window.FMM;

  const LAND_TYPES = {
    kontinente: { label: 'Mehrere Kontinente (2–3 gleich große)', equal: true, blobs: [2, 3], radius: [0.26, 0.3], noise: 0.42, edge: 0.1 },
    pangaea: { label: 'Superkontinent', blobs: [1, 1], radius: [0.42, 0.5], noise: 0.5, edge: 0.14 },
    insel: { label: 'Große Insel', blobs: [1, 1], radius: [0.3, 0.36], noise: 0.45, edge: 0.2 },
    archipel: { label: 'Archipel / Inselwelt', blobs: [10, 18], radius: [0.06, 0.13], noise: 0.6, edge: 0.1 },
    kueste: { label: 'Küstenregion (Land am Rand)', coast: true, blobs: [0, 0], radius: [0, 0], noise: 0.55, edge: 0 },
    zufall: { label: 'Freies Rauschen', blobs: [0, 0], radius: [0, 0], noise: 1, edge: 0.06 },
  };
  FMM.LAND_TYPES = LAND_TYPES;

  FMM.MAP_SIZES = {
    klein: { label: 'Klein (800 × 500)', width: 800, height: 500 },
    mittel: { label: 'Mittel (1200 × 750)', width: 1200, height: 750 },
    gross: { label: 'Groß (1600 × 1000)', width: 1600, height: 1000 },
  };

  // ---------- Höhenkarte ----------
  function generateHeights(p, rng) {
    const W = p.width, H = p.height, N = W * H;
    const type = LAND_TYPES[p.landType] || LAND_TYPES.kontinente;
    const nBase = FMM.createNoise2D(rng);
    const nWarp1 = FMM.createNoise2D(rng);
    const nWarp2 = FMM.createNoise2D(rng);
    const nRidge = FMM.createNoise2D(rng);
    const nMask = FMM.createNoise2D(rng);
    const nDetail = FMM.createNoise2D(rng);

    // Kontinentkerne
    const blobs = [];
    const count = rng.int(type.blobs[0], type.blobs[1]);
    if (type.equal) {
      // feste Anordnung, damit die Kontinente sich nicht überlappen und ähnlich viel Platz haben
      const m = Math.min(W, H);
      let pos;
      if (count === 2) {
        const tilt = rng.range(-0.12, 0.12);
        pos = [[0.27, 0.5 - tilt], [0.73, 0.5 + tilt]];
        if (W / H < 1.2) pos = [[0.5 - tilt, 0.27], [0.5 + tilt, 0.73]];
      } else if (W / H >= 1.45) {
        pos = [[0.18, rng.range(0.38, 0.62)], [0.5, rng.range(0.38, 0.62)], [0.82, rng.range(0.38, 0.62)]];
      } else {
        const up = rng.chance(0.5);
        pos = up ? [[0.25, 0.33], [0.75, 0.33], [0.5, 0.72]] : [[0.25, 0.67], [0.75, 0.67], [0.5, 0.28]];
      }
      for (const [px, py] of pos) {
        blobs.push({
          x: (px + rng.range(-0.04, 0.04)) * W,
          y: (py + rng.range(-0.04, 0.04)) * H,
          r: m * (count === 2 ? 0.34 : 0.27) * rng.range(0.92, 1.08),
          sx: count === 3 && W / H >= 1.45 ? rng.range(0.6, 0.8) : rng.range(0.85, 1.25),
          w: 1,
        });
      }
    }
    for (let b = 0; b < (type.equal ? 0 : count); b++) {
      const r = rng.range(type.radius[0], type.radius[1]);
      blobs.push({
        x: rng.range(0.15 + r * 0.4, 0.85 - r * 0.4) * W,
        y: rng.range(0.15 + r * 0.4, 0.85 - r * 0.4) * H,
        r: r * Math.min(W, H) * (1 + rng.range(-0.2, 0.3)),
        sx: rng.range(0.7, 1.5),
        w: rng.range(0.7, 1.1),
      });
    }
    // Küstenregion: Land auf einer Seite
    const coastSide = rng.int(0, 3);

    // Kontinentalplatten: wo sie zusammenstoßen, falten sich Gebirge auf (bzw. Inselbögen auf See),
    // wo sie auseinanderdriften, entstehen Grabenbrüche
    const plates = [];
    const plateCount = Math.max(5, Math.round(rng.range(7, 11) * Math.sqrt((W * H) / (1200 * 750))));
    for (let k = 0; k < plateCount; k++) {
      const a = rng() * Math.PI * 2, sp = rng.range(0.35, 1);
      plates.push({ x: rng() * W, y: rng() * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
    const plateW = Math.min(W, H) * 0.075;

    const scale = (p.featureScale || 1) * 3.2;
    const mtn = p.mountains == null ? 0.5 : p.mountains;
    const h = new Float32Array(N);
    const region = type.equal ? new Uint8Array(N) : null;
    const riftW = Math.min(W, H) * 0.07;
    const edgeW = Math.max(1, type.edge * Math.min(W, H));

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x / H) * scale, v = (y / H) * scale;
        // Domain Warping für natürlichere Küsten
        const wu = u + 0.45 * FMM.fbm(nWarp1, u * 0.7 + 3.1, v * 0.7 + 7.7, 4, 2, 0.5);
        const wv = v + 0.45 * FMM.fbm(nWarp2, u * 0.7 - 5.3, v * 0.7 + 1.9, 4, 2, 0.5);
        let e = FMM.fbm(nBase, wu, wv, 7, 2.02, 0.5) * type.noise;

        let mass = 0;
        const ou = FMM.fbm(nWarp1, u * 0.5, v * 0.5, 3, 2, 0.5);
        const ov = FMM.fbm(nWarp2, u * 0.5, v * 0.5, 3, 2, 0.5);
        for (const b of blobs) {
          // verzerrte Distanz für unregelmäßige Kontinentformen
          const dx = ((x - b.x) / b.sx) + ou * b.r * 0.6;
          const dy = ((y - b.y) * b.sx) + ov * b.r * 0.6;
          const dd = Math.sqrt(dx * dx + dy * dy) / b.r;
          mass = Math.max(mass, b.w * (1 - FMM.smoothstep(0.2, 1.15, dd)));
        }
        if (type.coast) {
          const t = [x / W, 1 - x / W, y / H, 1 - y / H][coastSide];
          mass = 1 - FMM.smoothstep(0.25, 0.75, t + ou * 0.25);
        }
        e += mass * 0.8;

        // getrennte Kontinente: jede Zelle gehört zum nächsten Kern (mit gewellten Grenzen),
        // entlang der Grenzen verläuft ein Meeresgraben
        if (region) {
          const qx = x + ou * Math.min(W, H) * 0.12, qy = y + ov * Math.min(W, H) * 0.12;
          let d1 = Infinity, d2 = Infinity, k1 = 0;
          for (let k = 0; k < blobs.length; k++) {
            const dd = Math.hypot(qx - blobs[k].x, qy - blobs[k].y);
            if (dd < d1) { d2 = d1; d1 = dd; k1 = k; } else if (dd < d2) d2 = dd;
          }
          region[y * W + x] = k1;
          e -= (1 - FMM.smoothstep(0, riftW, (d2 - d1) / 2)) * 0.9;
        }

        // Rand der Karte wird zu Meer
        if (edgeW > 1) {
          const de = Math.min(x, W - 1 - x, y, H - 1 - y) / edgeW;
          e -= (1 - FMM.smoothstep(0, 1, de)) * 0.7;
        }

        // Gebirgsketten entlang konvergenter Plattengrenzen (+ etwas Hügelland aus Rauschen)
        const px = x + ou * Math.min(W, H) * 0.15, py = y + ov * Math.min(W, H) * 0.15;
        let d1 = Infinity, d2 = Infinity, p1 = 0, p2 = 0;
        for (let k = 0; k < plates.length; k++) {
          const dd = Math.hypot(px - plates[k].x, py - plates[k].y);
          if (dd < d1) { d2 = d1; p2 = p1; d1 = dd; p1 = k; } else if (dd < d2) { d2 = dd; p2 = k; }
        }
        const A = plates[p1], B = plates[p2];
        let nx = B.x - A.x, ny = B.y - A.y;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        const conv = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny; // > 0: Platten bewegen sich aufeinander zu
        const bdist = (d2 - d1) / 2;
        const uplift = Math.max(0, conv) * (1 - FMM.smoothstep(0, plateW, bdist));
        const rift = Math.max(0, -conv) * (1 - FMM.smoothstep(0, plateW * 0.45, bdist));
        const hills = FMM.smoothstep(0.1, 0.55, FMM.fbm(nMask, u * 0.55 + 11, v * 0.55 - 4, 3, 2, 0.5)) * 0.3;
        const mask = Math.max(FMM.smoothstep(0.05, 0.7, uplift), hills);
        e += uplift * 0.1 * mtn - rift * 0.1;
        // schmalere, kettenförmige Grate statt breiter Massive
        const ridge = Math.pow(FMM.ridged(nRidge, wu * 1.5, wv * 1.5, 6), 1.6);
        e += ridge * mask * mtn * 0.85 * FMM.smoothstep(-0.15, 0.25, e);
        e += FMM.fbm(nDetail, u * 6, v * 6, 3, 2, 0.5) * 0.025;
        h[y * W + x] = e;
      }
    }

    // leichte Glättung gegen Rauschartefakte im Relief
    blur(h, W, H);

    // Meeresspiegel so wählen, dass der gewünschte Landanteil entsteht
    const sample = [];
    const step = Math.max(1, Math.floor(N / 60000));
    for (let i = 0; i < N; i += step) sample.push(h[i]);
    sample.sort((a, b) => a - b);
    const landFrac = FMM.clamp(p.landFraction || 0.4, 0.05, 0.95);
    if (region) {
      // Meeresspiegel je Kontinentbereich, sodass jeder Kontinent gleich viel Land erhält
      const k = blobs.length;
      const per = Array.from({ length: k }, () => []);
      for (let i = 0; i < N; i += step) per[region[i]].push(h[i]);
      const target = (landFrac * N) / k / step;
      const seaR = per.map((arr) => {
        arr.sort((a, b) => a - b);
        const land = Math.min(arr.length * 0.85, target);
        return arr[Math.max(0, Math.floor(arr.length - land))];
      });
      for (let i = 0; i < N; i++) h[i] -= seaR[region[i]];
    } else {
      const sea = sample[Math.floor((1 - landFrac) * (sample.length - 1))];
      for (let i = 0; i < N; i++) h[i] -= sea;
    }

    // Küstendetails: verwirbeltes, feines Rauschen nur nahe dem Meeresspiegel
    // → zerklüftete Buchten, Landzungen und vorgelagerte Inselchen statt glatter Ränder
    const nCoast = FMM.createNoise2D(rng);
    const nCoastW = FMM.createNoise2D(rng);
    const cScale = 9 / ((p.featureScale || 1) * Math.min(W, H) / 750);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const near = Math.exp(-Math.abs(h[i]) / 0.05);
        if (near < 0.02) continue;
        const u = (x / H) * cScale, v = (y / H) * cScale;
        const wu = u + 0.5 * nCoastW(u * 0.6, v * 0.6), wv = v + 0.5 * nCoastW(u * 0.6 + 17, v * 0.6 - 9);
        h[i] += FMM.fbm(nCoast, wu, wv, 4, 2.1, 0.55) * 0.06 * near;
      }
    }

    let maxL = 1e-6, minO = -1e-6;
    for (let i = 0; i < N; i++) {
      if (h[i] > maxL) maxL = h[i];
      if (h[i] < minO) minO = h[i];
    }
    // Normalisieren: Land 0..1 (Tiefland flacher), Meer -1..0 (flache Schelfe)
    for (let i = 0; i < N; i++) {
      const v = h[i];
      if (v >= 0) h[i] = Math.pow(v / maxL, 1.35);
      else h[i] = -Math.pow(v / minO, 0.75);
    }
    // Einzelpixel-Inseln & -Seen entfernen (wirkt sauberer)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const land = h[i] >= 0;
        let same = 0;
        for (const [dx, dy] of FMM.N8) if ((h[i + dy * W + dx] >= 0) === land) same++;
        if (same <= 1) h[i] = land ? -0.01 : 0.005;
      }
    }
    // Erosion formt Täler, Grate und Schwemmebenen
    FMM.erode(h, W, H, p.erosion == null ? 0.6 : p.erosion, rng);
    return h;
  }

  function blur(h, W, H) {
    const tmp = new Float32Array(h.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        tmp[i] = (h[x > 0 ? i - 1 : i] + 2 * h[i] + h[x < W - 1 ? i + 1 : i]) / 4;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        h[i] = (tmp[y > 0 ? i - W : i] + 2 * tmp[i] + tmp[y < H - 1 ? i + W : i]) / 4;
      }
    }
  }

  // Fjorde: an kalten Gebirgsküsten werden die unteren Flusstäler unter den Meeresspiegel abgesenkt
  // (wie von Gletschern ausgeschürfte Trogtäler)
  function carveFjords(map, d) {
    const W = map.width, H = map.height, h = map.heights;
    for (const path of d.rivers) {
      const n = path.length;
      const mouth = path[n - 1];
      if (h[mouth] >= 0) continue; // Fluss muss ins Meer münden
      if (d.latT[(mouth / W) | 0] > 0.32) continue; // nur in kalten Breiten
      const L = Math.min(n - 1, 45);
      let maxH = 0;
      for (let k = 1; k <= L; k++) maxH = Math.max(maxH, h[path[n - 1 - k]]);
      if (maxH < 0.36) continue; // nur an gebirgigen Küsten
      for (let k = 1; k <= L; k++) {
        const c = path[n - 1 - k];
        const f = 1 - k / L;
        const depth = -0.005 - 0.07 * f;
        const rad = 1.1 + 2.2 * f;
        const cx = c % W, cy = (c / W) | 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const dist = Math.hypot(dx, dy);
            if (dist > rad) continue;
            const x = cx + dx, y = cy + dy;
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
            const j = y * W + x;
            h[j] = Math.min(h[j], depth * (1 - (dist / (rad + 0.5)) * 0.6));
          }
        }
      }
    }
  }

  // Senken füllen und nur einige natürliche Seen übrig lassen
  function reduceLakes(map, d, rng) {
    const W = map.width, H = map.height, N = W * H, h = map.heights, filled = d.filled;
    const cand = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (h[i] >= 0 && filled[i] - h[i] > 0.004) cand[i] = 1;
    const keep = new Uint8Array(N);
    const minLake = Math.max(8, Math.round(N / 40000));
    const maxLake = N * 0.0035;
    const comps = [];
    const stack = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (cand[i] !== 1) continue;
      const comp = [];
      let sp = 0;
      stack[sp++] = i;
      cand[i] = 2;
      while (sp > 0) {
        const c = stack[--sp];
        comp.push(c);
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of FMM.N4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (cand[n] === 1) { cand[n] = 2; stack[sp++] = n; }
        }
      }
      // keine Seen auf Gipfeln: nur in tieferen Lagen
      if (comp.length >= minLake && comp.length <= maxLake && h[comp[0]] < 0.32) comps.push(comp);
    }
    // zufällige Auswahl, bevorzugt tiefer gelegene Seen
    comps.sort((a, b) => h[a[0]] - h[b[0]] + rng.range(-0.3, 0.3));
    const maxLakes = Math.round(4 + N / 120000);
    for (const comp of comps.slice(0, maxLakes)) for (const c of comp) keep[c] = 1;
    for (let i = 0; i < N; i++) if (h[i] >= 0 && !keep[i] && filled[i] > h[i]) h[i] = filled[i];
  }

  // ---------- Politik: Hauptstädte, Ausbreitung, Städte ----------
  function habitability(map, d, i) {
    const h = map.heights[i];
    if (h < 0 || d.lake[i]) return -1;
    const W = map.width;
    const t = FMM.cellTemp(d.latT[(i / W) | 0], h);
    if (h > 0.62 || t < 0.12) return -1;
    let s = 1 - h * 1.3;
    s -= Math.abs(t - 0.58) * 1.1;
    s += map.moisture[i] * 0.35;
    if (d.flux[i] > d.riverThreshold * 0.6) s += 0.55;
    if (d.coastDist[i] <= 2) s += 0.35;
    // Nähe zu Seen
    const x = i % W, y = (i / W) | 0;
    if (x > 2 && y > 2 && x < W - 3 && y < map.height - 3) {
      if (d.lake[i + 2] || d.lake[i - 2] || d.lake[i + 2 * W] || d.lake[i - 2 * W]) s += 0.3;
    }
    return s;
  }

  function pickSites(map, d, rng, count, minDist, existing, scoreBias) {
    const W = map.width, N = W * map.height;
    const cands = [];
    const tries = Math.min(N, 40000);
    for (let k = 0; k < tries; k++) {
      const i = Math.floor(rng() * N);
      const s = habitability(map, d, i);
      if (s > 0) cands.push({ i, s: s + rng() * (scoreBias || 0.4) });
    }
    cands.sort((a, b) => b.s - a.s);
    const picked = [];
    const all = existing.slice();
    const md2 = minDist * minDist;
    for (const c of cands) {
      if (picked.length >= count) break;
      const x = c.i % W, y = (c.i / W) | 0;
      let ok = true;
      for (const e of all) {
        const dx = e.x - x, dy = e.y - y;
        if (dx * dx + dy * dy < md2) { ok = false; break; }
      }
      if (ok) {
        const site = { x, y, i: c.i };
        picked.push(site);
        all.push(site);
      }
    }
    return picked;
  }

  function cultureFor(rng, temp) {
    const w = temp < 0.35
      ? { nordisch: 4, germanisch: 2, rau: 2, elbisch: 1 }
      : temp < 0.68
        ? { germanisch: 3, romanisch: 3, elbisch: 2, nordisch: 1, rau: 1 }
        : { orientalisch: 4, romanisch: 2, elbisch: 1, rau: 1 };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'germanisch';
  }

  // Staatsfarben: gut unterscheidbar, gedeckte Pastelltöne
  FMM.stateColor = function (index, rng) {
    const hue = (index * 137.508 + (rng ? rng() * 20 : 0)) % 360;
    return FMM.hslToHex(hue, 42 + (index % 3) * 8, 62 + (index % 2) * 6);
  };

  // Ausbreitung der Staaten (Dijkstra über das Gelände)
  FMM.expandStates = function (map, d, seeds, opts) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const owner = new Uint16Array(N);
    const cost = new Float32Array(N).fill(Infinity);
    const heap = new FMM.MinHeap(N >> 2);
    const only = opts && opts.onlyMask; // optional: nur diese Zellen dürfen neu vergeben werden
    for (const s of seeds) {
      cost[s.i] = 0;
      owner[s.i] = s.stateId;
      heap.push(s.i, 0);
    }
    const power = {};
    for (const s of seeds) power[s.stateId] = s.power || 1;
    while (heap.size > 0) {
      const c = heap.pop();
      const k0 = heap.topKey;
      if (k0 > cost[c]) continue;
      const cx = c % W, cy = (c / W) | 0;
      const o = owner[c];
      const pw = power[o];
      for (let k = 0; k < 8; k++) {
        const nx = cx + FMM.N8[k][0], ny = cy + FMM.N8[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (only && !only[n] && h[n] >= 0) continue;
        const hn = h[n];
        let step = k < 4 ? 1 : 1.414;
        let mult = 1;
        if (hn < 0) {
          // Meerengen sind passierbar, offene See nicht
          if (d.coastDist[n] > 12) continue;
          mult = 7;
        } else {
          mult += Math.abs(hn - Math.max(0, h[c])) * 60; // Steigung
          if (hn > 0.45) mult += (hn - 0.45) * 14; // Gebirge
          if (d.isRiver[n] && !d.isRiver[c]) mult += 4; // Flüsse als natürliche Grenzen
          if (d.lake[n]) mult += 2;
        }
        const nc = Math.fround(cost[c] + (step * mult) / pw);
        if (nc < cost[n]) {
          cost[n] = nc;
          owner[n] = o;
          heap.push(n, nc);
        }
      }
    }
    // Meer erhält keinen Besitzer
    for (let i = 0; i < N; i++) if (h[i] < 0) owner[i] = 0;
    return owner;
  };

  function generatePolitics(map, d, rng, p, names) {
    const W = map.width, H = map.height, N = W * H;
    let land = 0;
    for (let i = 0; i < N; i++) if (map.heights[i] >= 0) land++;
    const nStates = Math.max(1, p.stateCount | 0);
    const nCities = Math.max(0, p.cityCount | 0);

    const capSpacing = Math.sqrt(land / nStates) * 0.55;
    const capitals = pickSites(map, d, rng, nStates, capSpacing, [], 0.6);
    map.states = [];
    map.cities = [];
    const seeds = [];
    capitals.forEach((c, k) => {
      const t = FMM.cellTemp(d.latT[c.y], map.heights[c.i]);
      const culture = p.culture && p.culture !== 'gemischt' ? p.culture : cultureFor(rng, t);
      const id = k + 1;
      const stateName = names.name(culture);
      const cityId = FMM.uid();
      map.states.push({
        id,
        name: stateName,
        form: names.stateForm(culture),
        color: FMM.stateColor(k, rng),
        culture,
        capital: cityId,
      });
      map.cities.push({ id: cityId, x: c.x + 0.5, y: c.y + 0.5, name: names.name(culture), type: 'capital' });
      seeds.push({ i: c.i, stateId: id, power: rng.range(0.8, 1.25) });
    });
    map.stateMap = FMM.expandStates(map, d, seeds);

    const citySpacing = Math.sqrt(land / Math.max(1, nCities + nStates)) * 0.5;
    const others = pickSites(map, d, rng, nCities, citySpacing, capitals, 0.9);
    others.forEach((c, k) => {
      const st = map.states.find((s) => s.id === map.stateMap[c.i]);
      const culture = st ? st.culture : cultureFor(rng, 0.5);
      map.cities.push({
        id: FMM.uid(),
        x: c.x + 0.5,
        y: c.y + 0.5,
        name: names.name(culture),
        type: k < nCities * 0.3 ? 'city' : 'town',
      });
    });
  }

  // ---------- Meeresbeschriftungen ----------
  function generateSeaLabels(map, d, rng, names) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const seen = new Uint8Array(N);
    const queue = new Int32Array(N);
    const labels = [];
    const comps = [];
    for (let i = 0; i < N; i++) {
      if (h[i] >= 0 || seen[i]) continue;
      let qh = 0, qt = 0;
      queue[qt++] = i;
      seen[i] = 1;
      let best = i, bestD = -1;
      while (qh < qt) {
        const c = queue[qh++];
        const cx = c % W, cy = (c / W) | 0;
        const sc = Math.min(d.coastDist[c], cx - W * 0.08, W * 0.92 - cx, cy - H * 0.06, H * 0.94 - cy);
        if (sc > bestD) { bestD = sc; best = c; }
        for (let k = 0; k < 4; k++) {
          const nx = cx + FMM.N4[k][0], ny = cy + FMM.N4[k][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (!seen[n] && h[n] < 0) { seen[n] = 1; queue[qt++] = n; }
        }
      }
      comps.push({ size: qt, best, bestD });
    }
    comps.sort((a, b) => b.size - a.size);
    const cultures = Object.keys(FMM.CULTURES);
    for (const c of comps.slice(0, 4)) {
      if (c.size < N * 0.008 || c.bestD < 5) continue;
      const kind = c.size > N * 0.2 ? 'ocean' : c.size > N * 0.03 ? 'sea' : 'bay';
      const size = kind === 'ocean' ? 22 : kind === 'sea' ? 16 : 12;
      labels.push({
        id: FMM.uid(),
        x: (c.best % W) + 0.5,
        y: ((c.best / W) | 0) + 0.5,
        text: names.seaName(rng.pick(cultures), kind),
        kind: 'sea',
        size: Math.round(size * Math.min(W, H) / 750),
        angle: 0,
      });
    }
    return labels;
  }

  // ---------- Hauptfunktion ----------
  FMM.generateMap = function (params) {
    const p = Object.assign({
      name: 'Neue Welt',
      seed: FMM.randomSeed(),
      width: 1200,
      height: 750,
      landType: 'kontinente',
      landFraction: 0.4,
      mountains: 0.5,
      featureScale: 1,
      climate: 'gemaessigt',
      riverDensity: 1,
      stateCount: 10,
      cityCount: 40,
      culture: 'gemischt',
      erosion: 0.6,
      wind: 'auto',
    }, params);
    const rng = FMM.makeRng(p.seed);
    const map = {
      version: 1,
      id: FMM.uid(),
      name: p.name,
      created: Date.now(),
      width: p.width,
      height: p.height,
      settings: {
        seed: p.seed,
        landType: p.landType,
        landFraction: p.landFraction,
        mountains: p.mountains,
        featureScale: p.featureScale,
        climate: p.climate,
        riverDensity: p.riverDensity,
        stateCount: p.stateCount,
        cityCount: p.cityCount,
        culture: p.culture,
        erosion: p.erosion,
        wind: p.wind,
        kmPerPixel: p.kmPerPixel || 4,
      },
      view: { style: 'geo', layers: Object.assign({}, FMM.STYLE_PRESETS.geo) },
      states: [],
      cities: [],
      labels: [],
    };
    map.heights = generateHeights(p, rng);
    const d0 = { latT: FMM.Derive.latitudeTemps(map) };
    FMM.Derive.coastDistance(map, d0);
    map.moisture = FMM.computeMoisture(map);
    map.stateMap = new Uint16Array(map.width * map.height);
    map.biomeMap = new Uint8Array(map.width * map.height).fill(255);
    FMM.Derive.hydrology(map, d0);
    reduceLakes(map, d0, rng);
    carveFjords(map, d0);
    const d = FMM.Derive.all(map);
    const names = new FMM.NameGen(rng);
    generatePolitics(map, d, rng, p, names);
    map.labels = generateSeaLabels(map, d, rng, names);
    return map;
  };

  // Staatsgrenzen neu berechnen (Hauptstädte bleiben erhalten)
  FMM.recomputeBorders = function (map, d) {
    const seeds = [];
    const rng = FMM.makeRng(map.settings.seed + '-borders-' + Date.now());
    for (const s of map.states) {
      const cap = map.cities.find((c) => c.id === s.capital);
      if (!cap) continue;
      const i = Math.floor(cap.y) * map.width + Math.floor(cap.x);
      if (map.heights[i] < 0) continue;
      seeds.push({ i, stateId: s.id, power: rng.range(0.85, 1.2) });
    }
    if (seeds.length) map.stateMap = FMM.expandStates(map, d, seeds);
  };

  FMM.STYLE_PRESETS = {
    geo: { relief: true, rivers: true, borders: false, stateFill: false, cities: true, labels: true, stateLabels: false, grid: false, compass: true, scale: true, legend: true, roads: true, symbols: false },
    political: { relief: true, rivers: true, borders: true, stateFill: true, cities: true, labels: true, stateLabels: true, grid: false, compass: true, scale: true, roads: true, symbols: false },
    fantasy: { relief: true, rivers: true, borders: false, stateFill: false, cities: true, labels: true, stateLabels: false, grid: false, compass: true, scale: true, legend: false, roads: true, symbols: true },
    antique: { relief: true, rivers: true, borders: true, stateFill: false, cities: true, labels: true, stateLabels: true, grid: true, compass: true, scale: true, roads: true, symbols: true },
  };
})();
