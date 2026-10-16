/* „Skizze → Gelände“: grobe Formen (Umriss, Linie, Fläche) werden zu natürlichem Gelände.
   Wird von den Form-Werkzeugen im Editor und vom KI-Assistenten gemeinsam genutzt.
   Alle Koordinaten in Kartenzellen; Polygone und Linien als [[x, y], …]. */
(function () {
  'use strict';
  const FMM = window.FMM;

  const noiseFor = (tag) => FMM.createNoise2D(FMM.makeRng(tag + ':' + Math.random()));

  // ---------- Hilfsfunktionen ----------
  function bbox(pts, pad, W, H) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return {
      x0: Math.max(0, Math.floor(x0 - pad)), y0: Math.max(0, Math.floor(y0 - pad)),
      x1: Math.min(W - 1, Math.ceil(x1 + pad)), y1: Math.min(H - 1, Math.ceil(y1 + pad)),
      size: Math.max(4, x1 - x0, y1 - y0),
    };
  }

  function polygonArea(poly) {
    let a = 0;
    for (let k = 0; k < poly.length; k++) {
      const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2);
  }

  // Polygon in einen Ausschnitt rastern (Zellmittelpunkte, Even-odd-Regel)
  function rasterPolygon(poly, r) {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    const mask = new Uint8Array(w * h);
    const xs = [];
    for (let yy = 0; yy < h; yy++) {
      const py = r.y0 + yy + 0.5;
      xs.length = 0;
      for (let k = 0; k < poly.length; k++) {
        const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % poly.length];
        if ((ay <= py && by > py) || (by <= py && ay > py)) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k] - r.x0 - 0.5)), b = Math.min(w - 1, Math.floor(xs[k + 1] - r.x0 - 0.5));
        for (let xx = a; xx <= b; xx++) mask[yy * w + xx] = 1;
      }
    }
    return mask;
  }

  // Vorzeichenbehafteter Abstand zum Rand einer Maske (innen +, außen −), Chamfer-Verfahren
  function signedDistance(mask, w, h) {
    const INF = 1e9;
    const pass = (inside) => {
      const d = new Float32Array(w * h);
      for (let i = 0; i < d.length; i++) d[i] = (mask[i] === 1) === inside ? INF : 0;
      const A = 1, B = Math.SQRT2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + A);
        if (y > 0) {
          v = Math.min(v, d[i - w] + A);
          if (x > 0) v = Math.min(v, d[i - w - 1] + B);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
        }
        d[i] = v;
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + A);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + A);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + B);
          if (x > 0) v = Math.min(v, d[i + w - 1] + B);
        }
        d[i] = v;
      }
      return d;
    };
    const din = pass(true), dout = pass(false);
    const sd = new Float32Array(w * h);
    for (let i = 0; i < sd.length; i++) sd[i] = mask[i] ? Math.min(din[i], 1e6) - 0.5 : -Math.min(dout[i], 1e6) + 0.5;
    return sd;
  }

  // Abstand-Feld eines Polygons mit natürlich verwirbeltem Rand (Buchten, Landzungen, Inselchen)
  function naturalField(map, poly, roughness) {
    const W = map.width, H = map.height;
    const b0 = bbox(poly, 0, W, H);
    const size = Math.max(b0.size, Math.sqrt(polygonArea(poly)));
    const pad = Math.round(size * 0.25 + 8);
    const r = bbox(poly, pad, W, H);
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    const sd = signedDistance(rasterPolygon(poly, r), w, h);
    const nw1 = noiseFor('warp1'), nw2 = noiseFor('warp2'), nr = noiseFor('rand');
    const amp = size * 0.1 * roughness, sc = size * 0.3, sc2 = Math.max(5, size * 0.06), sc3 = Math.max(3, size * 0.02);
    const t = new Float32Array(w * h);
    const sample = (fx, fy) => {
      fx = FMM.clamp(fx, 0, w - 1.001); fy = FMM.clamp(fy, 0, h - 1.001);
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = iy * w + ix;
      const i1 = Math.min(i + 1, w * h - 1), i2 = Math.min(i + w, w * h - 1), i3 = Math.min(i + w + 1, w * h - 1);
      return (sd[i] * (1 - tx) + sd[i1] * tx) * (1 - ty) + (sd[i2] * (1 - tx) + sd[i3] * tx) * ty;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = r.x0 + x, gy = r.y0 + y;
        const wx = FMM.fbm(nw1, gx / sc, gy / sc, 3, 2, 0.5) * amp;
        const wy = FMM.fbm(nw2, gx / sc, gy / sc, 3, 2, 0.5) * amp;
        // grobe Buchten und Halbinseln + feine Zerklüftung der Küste
        t[y * w + x] = sample(x + wx, y + wy) + (FMM.fbm(nr, gx / sc2, gy / sc2, 4, 2.1, 0.55) * size * 0.06 + FMM.fbm(nr, gx / sc3 + 50, gy / sc3, 3, 2, 0.5) * size * 0.015) * roughness;
      }
    }
    return { r, w, h, t, size };
  }

  // Chaikin-Glättung einer offenen Linie und gleichmäßiges Neuabtasten
  function smoothLine(points, iterations) {
    let p = points.map((q) => [q[0], q[1]]);
    for (let it = 0; it < iterations; it++) {
      if (p.length < 3) break;
      const o = [p[0]];
      for (let k = 0; k < p.length - 1; k++) {
        const [ax, ay] = p[k], [bx, by] = p[k + 1];
        o.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      o.push(p[p.length - 1]);
      p = o;
    }
    return p;
  }
  function resample(points, step) {
    const out = [points[0].slice()];
    let carry = 0;
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, ay] = points[k], [bx, by] = points[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      let s = step - carry;
      while (s <= len) { out.push([ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len]); s += step; }
      carry = len - (s - step);
    }
    const last = points[points.length - 1];
    if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push(last.slice());
    return out;
  }

  const waterMask = (h) => { const w = new Uint8Array(h.length); for (let i = 0; i < h.length; i++) if (h[i] < 0) w[i] = 1; return w; };

  // leichte Erosion nur im geänderten Ausschnitt, mit weicher Kante zurückgeschrieben
  function localErode(map, r, strength) {
    if (!(strength > 0)) return;
    const W = map.width, H = map.height, h = map.heights;
    const x0 = Math.max(0, r.x0 - 6), y0 = Math.max(0, r.y0 - 6), x1 = Math.min(W - 1, r.x1 + 6), y1 = Math.min(H - 1, r.y1 + 6);
    const w = x1 - x0 + 1, hh = y1 - y0 + 1;
    if (w < 12 || hh < 12) return;
    const sub = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) sub[y * w + x] = h[(y0 + y) * W + x0 + x];
    const before = sub.slice();
    FMM.erode(sub, w, hh, strength, FMM.makeRng('erosion:' + Math.random()));
    const F = 8;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const e = Math.min(x, y, w - 1 - x, hh - 1 - y);
      const k = FMM.smoothstep(0, F, e);
      const i = y * w + x;
      h[(y0 + y) * W + x0 + x] = before[i] + (sub[i] - before[i]) * k;
    }
  }

  function finish(map, r, wasWater, erode) {
    localErode(map, r, erode == null ? 0.35 : erode);
    map.moisture = FMM.computeMoisture(map);
    return { rect: r, wasWater };
  }

  const Sculpt = {};

  // ---------- Land aufschütten ----------
  // relief: 'flach' | 'huegelig' | 'bergig'
  Sculpt.addLandmass = function (map, poly, opts) {
    opts = opts || {};
    if (!poly || poly.length < 3) throw new Error('Umriss braucht mindestens drei Punkte');
    const W = map.width, h = map.heights;
    const wasWater = waterMask(h);
    const f = naturalField(map, poly, opts.roughness == null ? 1 : opts.roughness);
    const { r, w, t, size } = f;
    const hillAmp = { flach: 0.03, huegelig: 0.09, bergig: 0.16 }[opts.relief || 'huegelig'] || 0.09;
    const nh = noiseFor('huegel'), nk = noiseFor('kamm');
    const shelf = Math.max(6, size * 0.12);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < w; x++) {
        const tv = t[y * w + x];
        const gx = r.x0 + x, gy = r.y0 + y, i = gy * W + gx;
        if (tv > 0) {
          const inland = 1 - Math.exp(-tv / (0.18 * size));
          let v = 0.012 + 0.12 * inland;
          const hill = FMM.smoothstep(-0.15, 0.6, FMM.fbm(nh, gx / (size * 0.2), gy / (size * 0.2), 4, 2, 0.5));
          v += hill * hillAmp * (1 - Math.exp(-tv / (0.08 * size)));
          if (opts.relief === 'bergig') v += Math.pow(FMM.ridged(nk, gx / (size * 0.18), gy / (size * 0.18), 4), 2) * 0.22 * inland;
          if (v > h[i]) h[i] = v;
        } else if (tv > -shelf && h[i] < 0) {
          // flacher Schelf vor der neuen Küste
          const target = -0.01 + (tv / shelf) * 0.22;
          if (target > h[i]) h[i] = target;
        }
      }
    }
    return finish(map, r, wasWater, opts.erode);
  };

  // ---------- Land versenken ----------
  Sculpt.removeLand = function (map, poly, opts) {
    opts = opts || {};
    const W = map.width, h = map.heights;
    const wasWater = waterMask(h);
    const f = naturalField(map, poly, opts.roughness == null ? 1 : opts.roughness);
    const { r, w, t, size } = f;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < w; x++) {
        const tv = t[y * w + x];
        if (tv <= 0) continue;
        const i = (r.y0 + y) * W + r.x0 + x;
        const v = -0.02 - 0.3 * (1 - Math.exp(-tv / (0.2 * size)));
        if (v < h[i]) h[i] = v;
      }
    }
    return finish(map, r, wasWater, 0);
  };

  // ---------- Gebirgszug entlang einer Linie ----------
  // width: halbe Breite in Zellen; height: 0.2 (Hügelkette) … 1 (gewaltig)
  Sculpt.addMountainRange = function (map, points, opts) {
    opts = opts || {};
    if (!points || points.length < 2) throw new Error('Gebirgslinie braucht mindestens zwei Punkte');
    const W = map.width, H = map.height, h = map.heights;
    const M = Math.min(W, H);
    const wasWater = waterMask(h);
    const width = opts.width || M * 0.035;
    const height = opts.height == null ? 0.6 : opts.height;
    const line = resample(smoothLine(points, 3), Math.max(1.5, width / 3));
    const n = line.length;
    const cum = [0];
    for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
    const L = cum[n - 1] || 1;
    const r = bbox(line, width * 2.6 + 4, W, H);
    const nv = noiseFor('kette'), nr = noiseFor('grate');
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        // nächster Punkt auf der Linie (Abstand, Bogenlänge, Seite)
        let best = Infinity, bs = 0, side = 0;
        for (let k = 0; k < n - 1; k++) {
          const [ax, ay] = line[k], [bx, by] = line[k + 1];
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
          const u = FMM.clamp(((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / l2, 0, 1);
          const px = ax + dx * u - x - 0.5, py = ay + dy * u - y - 0.5;
          const d2 = px * px + py * py;
          if (d2 < best) { best = d2; bs = cum[k] + u * Math.sqrt(l2); side = Math.sign(dx * (y + 0.5 - ay) - dy * (x + 0.5 - ax)); }
        }
        const d = Math.sqrt(best);
        if (d > width * 2.6) continue;
        // Breite und Höhe variieren entlang der Kette → Pässe und Gipfelgruppen
        const wv = width * (0.75 + 0.35 * nv(bs / (width * 3), 3.3));
        const hv = height * (0.7 + 0.4 * (nv(bs / (width * 4) + 17, 9.1) * 0.5 + 0.5));
        const taper = FMM.smoothstep(0, width * 1.2, bs) * FMM.smoothstep(0, width * 1.2, L - bs);
        const g = Math.exp(-(d / wv) * (d / wv));
        const ridge = Math.pow(FMM.ridged(nr, bs / (width * 1.6), (side * d) / (width * 0.45), 5), 1.4);
        let add = hv * g * (0.35 + 0.65 * ridge) + hv * 0.15 * Math.exp(-(d / (2.2 * wv)) * (d / (2.2 * wv)));
        add *= taper;
        if (add <= 0.001) continue;
        const i = y * W + x;
        h[i] = h[i] < 0 ? h[i] + add * 1.3 : h[i] + add;
        if (h[i] > 0.9) h[i] = 0.9 + 0.1 * (1 - Math.exp(-(h[i] - 0.9) / 0.1));
      }
    }
    return finish(map, r, wasWater, opts.erode);
  };

  // ---------- Fluss einziehen ----------
  // Gelände entlang des Pfads monoton fallend eintiefen; an der Quelle sorgt eine Quelle für genug Wasser
  Sculpt.carveRiver = function (map, points) {
    if (!points || points.length < 2) throw new Error('Fluss braucht mindestens zwei Punkte');
    const W = map.width, H = map.height, h = map.heights;
    const M = Math.min(W, H);
    const wasWater = waterMask(h);
    let path = resample(smoothLine(points, 2), 1);
    // Abschnitte im Meer am Anfang überspringen, am Ende an der Küste aufhören
    const hAt = (p) => h[FMM.clamp(Math.floor(p[1]), 0, H - 1) * W + FMM.clamp(Math.floor(p[0]), 0, W - 1)];
    while (path.length > 2 && hAt(path[0]) < 0) path.shift();
    const endSea = path.findIndex((p, k) => k > 0 && hAt(p) < 0);
    if (endSea > 0) path = path.slice(0, endSea + 1);
    if (path.length < 3) throw new Error('Der Fluss liegt nicht auf Land');
    // Zielhöhen: nie ansteigend
    const tgt = new Float32Array(path.length);
    tgt[0] = Math.max(0.02, hAt(path[0]));
    for (let k = 1; k < path.length; k++) tgt[k] = Math.max(0.0015, Math.min(tgt[k - 1] - 0.00035, hAt(path[k])));
    if (endSea > 0) tgt[path.length - 1] = Math.min(tgt[path.length - 1], hAt(path[path.length - 1]));
    const rad = Math.max(2.5, M * 0.008);
    const r = bbox(path, rad + 2, W, H);
    for (let k = 0; k < path.length; k++) {
      const [px, py] = path[k];
      const x0 = Math.max(0, Math.floor(px - rad)), x1 = Math.min(W - 1, Math.ceil(px + rad));
      const y0 = Math.max(0, Math.floor(py - rad)), y1 = Math.min(H - 1, Math.ceil(py + rad));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (h[i] < 0) continue;
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (d > rad) continue;
        const v = tgt[k] + (h[i] - tgt[k]) * FMM.smoothstep(0.6, rad, d);
        if (v < h[i]) h[i] = v;
      }
    }
    // Quelle: zusätzlicher Abfluss, damit der Fluss ab hier sichtbar ist
    if (!map.springs) map.springs = [];
    map.springs.push({ x: +path[0][0].toFixed(1), y: +path[0][1].toFixed(1) });
    return finish(map, r, wasWater, 0);
  };

  // ---------- Landschaftsform malen ----------
  Sculpt.paintBiome = function (map, poly, biomeId) {
    const W = map.width;
    const f = naturalField(map, poly, 1);
    const { r, w, t } = f;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < w; x++) {
      if (t[y * w + x] <= 0) continue;
      const i = (r.y0 + y) * W + r.x0 + x;
      if (map.heights[i] >= 0) map.biomeMap[i] = biomeId;
    }
    return { rect: r, wasWater: null };
  };

  // ---------- Landmasse finden ----------
  Sculpt.landmassAt = function (map, x, y) {
    const W = map.width, H = map.height, h = map.heights, N = W * H;
    let start = -1;
    for (let rr = 0; rr <= 12 && start < 0; rr++) {
      for (let dy = -rr; dy <= rr && start < 0; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const xx = Math.floor(x) + dx, yy = Math.floor(y) + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (h[yy * W + xx] >= 0) { start = yy * W + xx; break; }
      }
    }
    if (start < 0) return null;
    const mask = new Uint8Array(N), q = new Int32Array(N);
    let a = 0, b = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0;
    q[b++] = start; mask[start] = 1;
    while (a < b) {
      const c = q[a++];
      const cx = c % W, cy = (c / W) | 0;
      sx += cx; sy += cy;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (const [dx, dy] of FMM.N4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!mask[n] && h[n] >= 0) { mask[n] = 1; q[b++] = n; }
      }
    }
    return { mask, count: b, rect: { x0, y0, x1, y1 }, cx: sx / b + 0.5, cy: sy / b + 0.5 };
  };

  // ---------- Landmasse verschieben, drehen, skalieren ----------
  Sculpt.transformLandmass = function (map, lm, tr) {
    const W = map.width, H = map.height;
    const h0 = map.heights.slice(), bm0 = map.biomeMap.slice(), sm0 = map.stateMap.slice();
    const h = map.heights, wasWater = waterMask(h0);
    const { mask, rect, cx, cy } = lm;
    const dx = tr.dx || 0, dy = tr.dy || 0, ang = tr.angle || 0, sc = tr.scale || 1;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const fwd = (x, y) => {
      const ux = (x - cx) * sc, uy = (y - cy) * sc;
      return [cx + dx + ux * ca - uy * sa, cy + dy + ux * sa + uy * ca];
    };
    // Schelfband um die Landmasse (Abstand in Zellen) für einen weichen Übergang
    const band = 8;
    const bx0 = Math.max(0, rect.x0 - band), by0 = Math.max(0, rect.y0 - band), bx1 = Math.min(W - 1, rect.x1 + band), by1 = Math.min(H - 1, rect.y1 + band);
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const sub = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) sub[y * bw + x] = mask[(by0 + y) * W + bx0 + x];
    const sd = signedDistance(sub, bw, bh);
    // 1. alte Stelle zu Meer machen
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
      const i = y * W + x;
      if (mask[i]) { h[i] = -0.12; map.biomeMap[i] = 255; map.stateMap[i] = 0; }
    }
    // 2. an neuer Stelle einsetzen (inverse Abbildung je Zielzelle)
    const corners = [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].map(([x, y]) => fwd(x, y));
    const tx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) - 2)), tx1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((c) => c[0])) + 2));
    const ty0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) - 2)), ty1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((c) => c[1])) + 2));
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const ux = x + 0.5 - cx - dx, uy = y + 0.5 - cy - dy;
        const sxp = cx + (ux * ca + uy * sa) / sc - 0.5, syp = cy + (-ux * sa + uy * ca) / sc - 0.5;
        const lx = sxp - bx0, ly = syp - by0;
        if (lx < 0 || ly < 0 || lx > bw - 1.001 || ly > bh - 1.001) continue;
        const ix = lx | 0, iy = ly | 0, fx = lx - ix, fy = ly - iy, j = iy * bw + ix;
        const sdv = (sd[j] * (1 - fx) + sd[j + 1] * fx) * (1 - fy) + (sd[j + bw] * (1 - fx) + sd[j + bw + 1] * fx) * fy;
        if (sdv < -band) continue;
        const gi = (by0 + iy) * W + bx0 + ix;
        const hv = (h0[gi] * (1 - fx) + h0[gi + 1] * fx) * (1 - fy) + (h0[gi + W] * (1 - fx) + h0[gi + W + 1] * fx) * fy;
        const i = y * W + x;
        if (sdv > 0) {
          const v = Math.max(hv, 0.002);
          if (v > h[i] || h[i] < 0) h[i] = v;
          const ni = (by0 + Math.round(ly)) * W + bx0 + Math.round(lx);
          map.biomeMap[i] = bm0[ni];
          map.stateMap[i] = sm0[ni];
        } else if (h[i] < 0) {
          // Schelf: weich ins umliegende Meer
          const k = 1 + sdv / band;
          h[i] = Math.max(h[i], hv * k + h[i] * (1 - k));
        }
      }
    }
    // 3. Städte, Orte und Beschriftungen auf der Landmasse mitbewegen
    const onLand = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      return xi >= 0 && yi >= 0 && xi < W && yi < H && mask[yi * W + xi] === 1;
    };
    const move = (o) => { const [nx, ny] = fwd(o.x, o.y); o.x = FMM.clamp(nx, 0, W - 1); o.y = FMM.clamp(ny, 0, H - 1); };
    for (const c of map.cities) if (onLand(c.x, c.y)) move(c);
    for (const p of map.pois || []) if (onLand(p.x, p.y)) move(p);
    for (const lb of map.labels) {
      if (lb.kind === 'sea' || !onLand(lb.x, lb.y)) continue;
      if (lb.path) for (let k = 0; k < lb.path.length; k += 2) { const [nx, ny] = fwd(lb.path[k], lb.path[k + 1]); lb.path[k] = +nx.toFixed(1); lb.path[k + 1] = +ny.toFixed(1); }
      move(lb);
      if (!lb.path && ang) lb.angle = (lb.angle || 0) + ang;
    }
    for (const s of map.states) {
      if (s.labelX != null && onLand(s.labelX, s.labelY)) { const [nx, ny] = fwd(s.labelX, s.labelY); s.labelX = nx; s.labelY = ny; }
    }
    if (map.springs) map.springs = map.springs.filter((s) => !onLand(s.x, s.y));
    const r = { x0: Math.min(rect.x0, tx0), y0: Math.min(rect.y0, ty0), x1: Math.max(rect.x1, tx1), y1: Math.max(rect.y1, ty1) };
    map.moisture = FMM.computeMoisture(map);
    return { rect: r, wasWater };
  };

  // ---------- Region neu würfeln ----------
  // Neue Höhenkarte mit neuem Seed erzeugen und nur innerhalb des Umrisses weich einblenden
  Sculpt.rerollRegion = function (map, poly, seed) {
    const W = map.width, H = map.height, h = map.heights;
    const wasWater = waterMask(h);
    seed = seed || FMM.randomSeed();
    const p = Object.assign({}, map.settings, { width: W, height: H, seed });
    const fresh = FMM.generateHeights(p, FMM.makeRng(seed));
    const f = naturalField(map, poly, 0.4);
    const { r, w, t, size } = f;
    const feather = Math.max(6, size * 0.08);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < w; x++) {
      const k = FMM.smoothstep(-feather * 0.5, feather, t[y * w + x]);
      if (k <= 0) continue;
      const i = (r.y0 + y) * W + r.x0 + x;
      h[i] = h[i] + (fresh[i] - h[i]) * k;
      if (k > 0.5) map.biomeMap[i] = 255;
    }
    if (map.springs) map.springs = map.springs.filter((s) => { const xi = Math.floor(s.x) - r.x0, yi = Math.floor(s.y) - r.y0; return !(xi >= 0 && yi >= 0 && xi < w && yi < f.h && t[yi * w + xi] > 0); });
    map.moisture = FMM.computeMoisture(map);
    return { rect: r, wasWater, seed };
  };

  Sculpt.rectPolygon = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  FMM.Sculpt = Sculpt;
})();
