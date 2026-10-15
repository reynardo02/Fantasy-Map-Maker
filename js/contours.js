/* Konturen: geglättete Vektorlinien für Küsten, Seeufer und Staatsgrenzen */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Chaikin-Glättung einer Polylinie [x0,y0,x1,y1,…]
  function chaikin(pts, iterations, closed) {
    let p = pts;
    for (let it = 0; it < iterations; it++) {
      const n = p.length / 2;
      if (n < 3) return p;
      const out = [];
      if (!closed) out.push(p[0], p[1]);
      const last = closed ? n : n - 1;
      for (let k = 0; k < last; k++) {
        const ax = p[2 * k], ay = p[2 * k + 1];
        const j = (k + 1) % n;
        const bx = p[2 * j], by = p[2 * j + 1];
        out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
      }
      if (!closed) out.push(p[2 * (n - 1)], p[2 * (n - 1) + 1]);
      p = out;
    }
    return p;
  }

  // Ketten aus einem Nachbarschaftsgraphen (jeder Knoten hat 1–n Nachbarn) bilden
  function chain(adj, pos) {
    const lines = [];
    const used = new Set();
    const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
    const walk = (start) => {
      for (const first of adj.get(start)) {
        if (used.has(key(start, first))) continue;
        const pts = [];
        const p0 = pos(start); pts.push(p0[0], p0[1]);
        let prev = start, cur = first;
        used.add(key(prev, cur));
        for (;;) {
          const p = pos(cur); pts.push(p[0], p[1]);
          const nb = adj.get(cur);
          if (nb.length !== 2) break; // Ende oder Verzweigung
          const next = nb[0] === prev ? nb[1] : nb[0];
          if (used.has(key(cur, next))) break;
          used.add(key(cur, next));
          prev = cur; cur = next;
        }
        const closed = cur === start && pts.length > 4;
        if (closed) pts.length -= 2; // Startpunkt nicht doppelt
        lines.push({ pts, closed });
      }
    };
    // erst offene Enden und Verzweigungen, dann geschlossene Ringe
    for (const [k, nb] of adj) if (nb.length !== 2) walk(k);
    for (const k of adj.keys()) walk(k);
    return lines;
  }

  /**
   * Isolinie (Marching Squares) eines Feldes auf Zellmittelpunkten.
   * value(x, y) liefert den Wert, level die Schwelle.
   */
  function isolines(W, H, value, level) {
    const adj = new Map();
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    };
    const eH = (x, y) => 2 * (y * W + x); // Kante (x,y)–(x+1,y)
    const eV = (x, y) => 2 * (y * W + x) + 1; // Kante (x,y)–(x,y+1)
    let rowA = new Float32Array(W), rowB = new Float32Array(W);
    for (let x = 0; x < W; x++) rowA[x] = value(x, 0) - level;
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W; x++) rowB[x] = value(x, y + 1) - level;
      for (let x = 0; x < W - 1; x++) {
        const a = rowA[x], b = rowA[x + 1], c = rowB[x + 1], d = rowB[x];
        const cs = (a >= 0 ? 1 : 0) | (b >= 0 ? 2 : 0) | (c >= 0 ? 4 : 0) | (d >= 0 ? 8 : 0);
        if (cs === 0 || cs === 15) continue;
        const T = eH(x, y), R = eV(x + 1, y), B = eH(x, y + 1), L = eV(x, y);
        switch (cs) {
          case 1: case 14: link(L, T); break;
          case 2: case 13: link(T, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(R, B); break;
          case 6: case 9: link(T, B); break;
          case 7: case 8: link(L, B); break;
          case 5: if ((a + b + c + d) / 4 >= 0) { link(T, R); link(B, L); } else { link(L, T); link(R, B); } break;
          case 10: if ((a + b + c + d) / 4 >= 0) { link(L, T); link(R, B); } else { link(T, R); link(B, L); } break;
        }
      }
      const t = rowA; rowA = rowB; rowB = t;
    }
    const pos = (e) => {
      const cell = e >> 1, x = cell % W, y = (cell / W) | 0;
      const v0 = value(x, y) - level;
      if (e & 1) {
        const v1 = value(x, y + 1) - level;
        const t = FMM.clamp(v0 / (v0 - v1), 0, 1);
        return [x + 0.5, y + 0.5 + t];
      }
      const v1 = value(x + 1, y) - level;
      const t = FMM.clamp(v0 / (v0 - v1), 0, 1);
      return [x + 0.5 + t, y + 0.5];
    };
    return chain(adj, pos).map((l) => ({ pts: chaikin(l.pts, 1, l.closed), closed: l.closed }));
  }

  // Küstenlinien (Meeresspiegel)
  function coastlines(map) {
    const W = map.width, h = map.heights;
    return isolines(W, map.height, (x, y) => h[y * W + x], 0);
  }

  // Seeufer
  function lakeShores(map, d) {
    const W = map.width, lake = d.lake;
    return isolines(W, map.height, (x, y) => lake[y * W + x], 0.5)
      .map((l) => ({ pts: chaikin(l.pts, 1, l.closed), closed: l.closed }));
  }

  // Staatsgrenzen: Zellkanten zwischen Landzellen verschiedener Staaten, verkettet und geglättet
  function borders(map) {
    const W = map.width, H = map.height, h = map.heights, sm = map.stateMap;
    const adj = new Map();
    const W1 = W + 1;
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (h[i] < 0) continue;
        const s = sm[i];
        if (x < W - 1 && h[i + 1] >= 0 && sm[i + 1] !== s) link(y * W1 + x + 1, (y + 1) * W1 + x + 1);
        if (y < H - 1 && h[i + W] >= 0 && sm[i + W] !== s) link((y + 1) * W1 + x, (y + 1) * W1 + x + 1);
      }
    }
    const pos = (v) => [v % W1, (v / W1) | 0];
    return chain(adj, pos).map((l) => ({ pts: chaikin(average(l.pts, 2, l.closed), 2, l.closed), closed: l.closed }));
  }

  // gleitender Mittelwert (Endpunkte bleiben fest) – entfernt Treppenstufen aus Rasterkanten
  function average(pts, radius, closed) {
    const n = pts.length / 2;
    if (n < 3) return pts;
    const out = new Array(pts.length);
    for (let k = 0; k < n; k++) {
      if (!closed && (k === 0 || k === n - 1)) { out[2 * k] = pts[2 * k]; out[2 * k + 1] = pts[2 * k + 1]; continue; }
      const r = closed ? radius : Math.min(radius, k, n - 1 - k);
      let sx = 0, sy = 0, c = 0;
      for (let j = -r; j <= r; j++) {
        const q = ((k + j) % n + n) % n;
        sx += pts[2 * q]; sy += pts[2 * q + 1]; c++;
      }
      out[2 * k] = sx / c; out[2 * k + 1] = sy / c;
    }
    return out;
  }

  function toPath(lines) {
    const p = new Path2D();
    for (const l of lines) {
      const pts = l.pts;
      if (pts.length < 4) continue;
      p.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) p.lineTo(pts[k], pts[k + 1]);
      if (l.closed) p.closePath();
    }
    return p;
  }

  FMM.Contours = { chaikin, isolines, coastlines, lakeShores, borders, toPath };
})();
