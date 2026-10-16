/* Landschaftsregionen (Gebirge, Wälder, Wüsten, Sümpfe, Seen) und Flüsse finden und benennen.
   Die Beschriftung folgt der Mittellinie der Region bzw. dem Flusslauf. */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Mittellinie einer Zellmenge: Hauptachse (PCA), in Abschnitte geteilt, je Abschnitt die Mitte quer zur Achse
  FMM.regionCenterline = function (cells, W, binLen) {
    let mx = 0, my = 0;
    for (const i of cells) { mx += i % W; my += (i / W) | 0; }
    mx /= cells.length; my /= cells.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const i of cells) {
      const dx = (i % W) - mx, dy = ((i / W) | 0) - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const c = Math.cos(th), s = Math.sin(th);
    let smin = Infinity, smax = -Infinity, tv = 0;
    for (const i of cells) {
      const dx = (i % W) - mx, dy = ((i / W) | 0) - my;
      const p = dx * c + dy * s;
      if (p < smin) smin = p;
      if (p > smax) smax = p;
      const q = -dx * s + dy * c;
      tv += q * q;
    }
    const len = smax - smin;
    const K = FMM.clamp(Math.round(len / binLen), 2, 24);
    const sum = new Float64Array(K), cnt = new Float64Array(K);
    for (const i of cells) {
      const dx = (i % W) - mx, dy = ((i / W) | 0) - my;
      const k = Math.min(K - 1, Math.floor(((dx * c + dy * s - smin) / (len || 1)) * K));
      sum[k] += -dx * s + dy * c; cnt[k]++;
    }
    let t = [];
    for (let k = 0; k < K; k++) t.push(cnt[k] ? sum[k] / cnt[k] : null);
    // Lücken füllen und zweimal glätten
    for (let k = 0; k < K; k++) if (t[k] == null) t[k] = k > 0 ? t[k - 1] : 0;
    for (let pass = 0; pass < 4; pass++) t = t.map((v, k) => (t[Math.max(0, k - 1)] + 2 * v + t[Math.min(K - 1, k + 1)]) / 4);
    const pts = [];
    for (let k = 0; k < K; k++) {
      const p = smin + ((k + 0.5) / K) * len;
      pts.push(mx + p * c - t[k] * s + 0.5, my + p * s + t[k] * c + 0.5);
    }
    return { pts, len, width: 2 * Math.sqrt(tv / cells.length), cx: mx + 0.5, cy: my + 0.5 };
  };

  // Polylinie auf eine Länge um ihre Mitte kürzen (Schrift soll nicht über die ganze Region laufen)
  function trimPath(pts, maxLen) {
    const n = pts.length / 2;
    const cum = [0];
    for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]));
    const L = cum[n - 1];
    if (L <= maxLen) return pts;
    const a = (L - maxLen) / 2, b = a + maxLen;
    const at = (sv) => {
      let k = 1;
      while (k < n - 1 && cum[k] < sv) k++;
      const f = (sv - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
      return [pts[2 * k - 2] + (pts[2 * k] - pts[2 * k - 2]) * f, pts[2 * k - 1] + (pts[2 * k + 1] - pts[2 * k - 1]) * f];
    };
    const out = at(a);
    for (let k = 0; k < n; k++) if (cum[k] > a && cum[k] < b) out.push(pts[2 * k], pts[2 * k + 1]);
    out.push(...at(b));
    return out;
  }

  // Steile Beschriftungen sind schwer lesbar und kippen in Kurven: dann gerade Linie mit höchstens ~50° Neigung
  const MAX_TILT = 0.88;
  function tame(pts) {
    const n = pts.length / 2;
    const dx = pts[2 * n - 2] - pts[0], dy = pts[2 * n - 1] - pts[1];
    let ang = Math.atan2(dy, dx);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    if (Math.abs(ang) <= MAX_TILT) return pts;
    let L = 0;
    for (let k = 1; k < n; k++) L += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
    const mi = (n >> 1) * 2, cx = pts[mi], cy = pts[mi + 1];
    const a = Math.sign(ang) * MAX_TILT, c = Math.cos(a) * L / 2, s = Math.sin(a) * L / 2;
    return [cx - c, cy - s, cx, cy, cx + c, cy + s];
  }
  const steep = (pts) => {
    const n = pts.length / 2;
    const ang = Math.atan2(pts[2 * n - 1] - pts[1], pts[2 * n - 2] - pts[0]);
    return Math.abs(Math.cos(ang)) < Math.cos(1.0);
  };

  // geschätzte Textbreite (Schrift wird erst beim Zeichnen gemessen)
  const textLen = (text, size, spacing) => text.length * size * (0.56 + spacing);

  FMM.generateRegionLabels = function (map, d, rng) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const BI = FMM.BIOME_ID;
    const used = [...map.cities.map((c) => c.name), ...map.states.map((s) => s.name), ...map.labels.map((l) => l.text)];
    const names = new FMM.NameGen(rng, used);
    const stateCulture = (x, y) => {
      const s = map.states.find((o) => o.id === map.stateMap[(y | 0) * W + (x | 0)]);
      return s ? s.culture : 'germanisch';
    };

    // Kategorie je Zelle
    const cat = new Uint8Array(N); // 0 nichts, 1 Gebirge, 2 Wald, 3 Wüste, 4 Sumpf, 5 See
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, v = h[i];
        if (v < 0) continue;
        if (d.lake[i]) { cat[i] = 5; continue; }
        if (v > 0.45) { cat[i] = 1; continue; }
        let bi = map.biomeMap[i];
        if (bi === 255) {
          const slope = Math.hypot(Math.max(0, h[i + 1]) - Math.max(0, h[i - 1]), Math.max(0, h[i + W]) - Math.max(0, h[i - W])) * 40 * (W / 1200);
          bi = FMM.classifyBiome(FMM.cellTemp(d.latT[y], v), map.moisture[i], v, slope, d.riverDist[i], 0, 0);
        }
        if (FMM.isForest(bi)) cat[i] = 2;
        else if (bi === BI.wueste) cat[i] = 3;
        else if (bi === BI.sumpf) cat[i] = 4;
      }
    }

    // zusammenhängende Gebiete je Kategorie
    const seen = new Uint8Array(N), queue = new Int32Array(N);
    const regions = [[], [], [], [], [], []];
    for (let i = 0; i < N; i++) {
      const k = cat[i];
      if (!k || seen[i]) continue;
      let qh = 0, qt = 0;
      queue[qt++] = i; seen[i] = 1;
      while (qh < qt) {
        const c = queue[qh++];
        for (const n of [c - 1, c + 1, c - W, c + W]) if (!seen[n] && cat[n] === k) { seen[n] = 1; queue[qt++] = n; }
      }
      regions[k].push(queue.slice(0, qt));
    }

    const labels = [];
    // Kollisionsprüfung: Stützpunkte entlang des Pfads mit Radius ~ halbe Schrifthöhe
    const placed = [];
    const samples = (pts, size) => {
      const out = [];
      const n = pts.length / 2;
      for (let k = 0; k < n - 1; k++) {
        const ax = pts[2 * k], ay = pts[2 * k + 1], bx = pts[2 * k + 2], by = pts[2 * k + 3];
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (size * 0.6)));
        for (let j = 0; j < m; j++) out.push(ax + ((bx - ax) * j) / m, ay + ((by - ay) * j) / m);
      }
      out.push(pts[2 * n - 2], pts[2 * n - 1]);
      return out;
    };
    const fits = (pts, size, opt) => {
      const sp = samples(pts, size), r = size * 0.55;
      for (let k = 0; k < sp.length; k += 2) {
        const x = sp[k], y = sp[k + 1];
        if (x < 4 * unit || y < 4 * unit || x > W - 4 * unit || y > H - 4 * unit) return false;
        if (opt.land && h[(y | 0) * W + (x | 0)] < 0) return false;
        for (const q of placed) for (let j = 0; j < q.sp.length; j += 2) if (Math.hypot(q.sp[j] - x, q.sp[j + 1] - y) < r + q.r) return false;
        if (opt.cities) for (const c of map.cities) if (Math.hypot(c.x - x, c.y - y) < r + 5 * unit) return false;
      }
      return true;
    };
    const place = (pts, size) => placed.push({ sp: samples(pts, size), r: size * 0.55 });
    const spec = {
      1: { sub: 'gebirge', min: 0.0012, max: 4, name: (c) => names.mountainName(c), spacing: 0.35, upper: true },
      2: { sub: 'wald', min: 0.0025, max: 4, name: (c) => names.forestName(c), spacing: 0.2 },
      3: { sub: 'wueste', min: 0.002, max: 2, name: (c) => names.desertName(c), spacing: 0.3 },
      4: { sub: 'sumpf', min: 0.0006, max: 2, name: (c) => names.swampName(c), spacing: 0.15 },
      5: { sub: 'see', min: 0.0004, max: 3, name: (c) => names.lakeName(c), spacing: 0.1 },
    };
    for (const k of [1, 2, 3, 4, 5]) {
      const sp = spec[k];
      const list = regions[k].filter((r) => r.length > N * sp.min).sort((a, b) => b.length - a.length).slice(0, sp.max);
      for (const cells of list) {
        const cl = FMM.regionCenterline(cells, W, 6 * unit);
        let text = sp.name(stateCulture(cl.cx, cl.cy));
        if (sp.upper) text = text.toUpperCase();
        // Größe nach Fläche, aber so, dass der Text ungefähr in die Region passt
        let size = FMM.clamp(Math.sqrt(cells.length) * 0.16, 8, k === 1 ? 17 : 15) * unit;
        const fit = (cl.len * 1.15) / textLen(text, 1, sp.spacing);
        size = Math.max(7 * unit, Math.min(size, fit));
        const pts = tame(trimPath(cl.pts, Math.max(textLen(text, size, sp.spacing) * 1.25, 20 * unit)));
        if (!fits(pts, size, { land: k !== 5, cities: k !== 1 })) continue;
        place(pts, size);
        const mi = (pts.length >> 2) * 2;
        labels.push({ id: FMM.uid(), kind: 'region', sub: sp.sub, text, x: +pts[mi].toFixed(1), y: +pts[mi + 1].toFixed(1), size: +(size / unit).toFixed(1), path: pts.map((v) => +v.toFixed(1)) });
      }
    }

    // Flüsse: die größten Ströme, beschriftet entlang eines Abschnitts im Mittellauf, leicht neben dem Fluss
    const rivers = d.rivers
      .filter((p) => p.length > 40 * unit)
      .map((p) => ({ p, f: d.flux[p[p.length - 1]] }))
      .sort((a, b) => b.f - a.f);
    const taken = [];
    for (const { p } of rivers) {
      if (taken.length >= 6) break;
      const mid = p[Math.floor(p.length * 0.55)];
      const mx = mid % W, my = (mid / W) | 0;
      if (taken.some((t) => Math.hypot(t[0] - mx, t[1] - my) < 60 * unit)) continue;
      // Punkte glätten (gleitendes Mittel)
      const raw = [];
      for (const i of p) raw.push(i % W + 0.5, ((i / W) | 0) + 0.5);
      const n = raw.length / 2, sm = [];
      for (let k = 0; k < n; k++) {
        let sx = 0, sy = 0, c = 0;
        for (let j = Math.max(0, k - 4); j <= Math.min(n - 1, k + 4); j++) { sx += raw[2 * j]; sy += raw[2 * j + 1]; c++; }
        sm.push(sx / c, sy / c);
      }
      const text = names.riverName(stateCulture(mx, my));
      const size = 8.5 * unit;
      // Abschnitt um 55 % des Laufs
      const need = textLen(text, size, 0.12) * 1.3;
      let k0 = Math.floor(n * 0.55), k1 = k0, L = 0;
      while (L < need && (k0 > 0 || k1 < n - 1)) {
        if (k1 < n - 1) { L += Math.hypot(sm[2 * k1 + 2] - sm[2 * k1], sm[2 * k1 + 3] - sm[2 * k1 + 1]); k1++; }
        if (L < need && k0 > 0) { L += Math.hypot(sm[2 * k0] - sm[2 * k0 - 2], sm[2 * k0 + 1] - sm[2 * k0 - 1]); k0--; }
      }
      if (L < need * 0.8) continue;
      // seitlich versetzen (auf die Seite „oberhalb“ des Flusses)
      const seg = sm.slice(2 * k0, 2 * k1 + 2);
      if (steep(seg)) continue;
      if (!fits(seg, size * 2.2, { land: false, cities: true })) continue;
      const dx = seg[seg.length - 2] - seg[0], dy = seg[seg.length - 1] - seg[1];
      const dl = Math.hypot(dx, dy) || 1;
      let nx = -dy / dl, ny = dx / dl;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const off = size * 0.75;
      const path = [];
      for (let j = 0; j < seg.length; j += 2) path.push(+(seg[j] + nx * off).toFixed(1), +(seg[j + 1] + ny * off).toFixed(1));
      taken.push([mx, my]);
      place(path, size);
      labels.push({ id: FMM.uid(), kind: 'river', text, x: path[(path.length >> 2) * 2], y: path[(path.length >> 2) * 2 + 1], size: 8.5, path });
    }
    return labels;
  };
})();
