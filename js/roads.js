/* Straßennetz: verbindet Städte über das Gelände (A*-Wegsuche auf grobem Raster).
   Straßen meiden Gebirge, Steilhänge und Gewässer und bündeln sich, wo schon Wege existieren. */
(function () {
  'use strict';
  const FMM = window.FMM;

  const F = 3; // Rastergröße in Kartenzellen

  function costGrid(map, d) {
    const W = map.width, H = map.height, h = map.heights;
    const cw = Math.ceil(W / F), ch = Math.ceil(H / F);
    const cost = new Float32Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const x = Math.min(W - 1, cx * F + 1), y = Math.min(H - 1, cy * F + 1);
        const i = y * W + x;
        const v = h[i];
        if (v < 0 || d.lake[i]) { cost[cy * cw + cx] = Infinity; continue; }
        const xr = Math.min(W - 1, x + F), yd = Math.min(H - 1, y + F);
        const slope = Math.abs(Math.max(0, h[y * W + xr]) - v) + Math.abs(Math.max(0, h[yd * W + x]) - v);
        let c = 1 + slope * 40;
        if (v > 0.4) c += (v - 0.4) * 25; // Gebirge
        if (d.riverDist[i] === 0) c += 3; // Brücke / Furt
        cost[cy * cw + cx] = c;
      }
    }
    return { cost, cw, ch };
  }

  function astar(g, used, from, to, maxNodes) {
    const { cost, cw, ch } = g;
    const N = cw * ch;
    const dist = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new FMM.MinHeap(1024);
    const tx = to % cw, ty = (to / cw) | 0;
    const hEst = (i) => Math.hypot((i % cw) - tx, ((i / cw) | 0) - ty) * 0.35;
    dist[from] = 0;
    heap.push(from, hEst(from));
    let n = 0;
    while (heap.size > 0) {
      const c = heap.pop();
      if (c === to) break;
      if (++n > maxNodes) return null;
      const cx = c % cw, cy = (c / cw) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + FMM.N8[k][0], ny = cy + FMM.N8[k][1];
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const nI = ny * cw + nx;
        let c2 = cost[nI];
        if (c2 === Infinity && nI !== to) continue;
        if (c2 === Infinity) c2 = 1;
        if (used[nI]) c2 *= 0.35; // vorhandene Straßen bevorzugen
        const nd = Math.fround(dist[c] + c2 * (k < 4 ? 1 : 1.414));
        if (nd < dist[nI]) {
          dist[nI] = nd;
          prev[nI] = c;
          heap.push(nI, nd + hEst(nI));
        }
      }
    }
    if (prev[to] < 0 && from !== to) return null;
    const path = [];
    for (let c = to; c >= 0; c = prev[c]) path.push(c);
    return path.reverse();
  }

  // einfache Union-Find-Struktur für den minimalen Spannbaum
  function makeUF(n) {
    const p = Array.from({ length: n }, (_, i) => i);
    const find = (a) => (p[a] === a ? a : (p[a] = find(p[a])));
    return { find, union: (a, b) => { p[find(a)] = find(b); } };
  }

  FMM.buildRoads = function (map, d) {
    const cities = map.cities.filter((c) => {
      const i = Math.floor(c.y) * map.width + Math.floor(c.x);
      return map.heights[i] >= 0;
    });
    const n = cities.length;
    if (n < 2) return { main: [], minor: [] };
    const g = costGrid(map, d);
    const cellOf = (c) => {
      const cx = FMM.clamp(Math.floor(c.x / F), 0, g.cw - 1), cy = FMM.clamp(Math.floor(c.y / F), 0, g.ch - 1);
      return cy * g.cw + cx;
    };

    // Kandidaten: die 4 nächsten Nachbarn jeder Stadt
    let land = 0;
    for (let i = 0; i < map.heights.length; i++) if (map.heights[i] >= 0) land++;
    const maxD = Math.sqrt(land / n) * 3;
    const cand = new Map();
    for (let a = 0; a < n; a++) {
      const near = [];
      for (let b = 0; b < n; b++) {
        if (a === b) continue;
        const dd = Math.hypot(cities[a].x - cities[b].x, cities[a].y - cities[b].y);
        if (dd <= maxD) near.push([dd, b]);
      }
      near.sort((p, q) => p[0] - q[0]);
      for (const [dd, b] of near.slice(0, 4)) {
        const k = a < b ? a + ',' + b : b + ',' + a;
        if (!cand.has(k)) cand.set(k, { a: Math.min(a, b), b: Math.max(a, b), d: dd });
      }
    }
    const edges = [...cand.values()].sort((p, q) => p.d - q.d);

    // Spannbaum + einige zusätzliche kurze Verbindungen (Netz statt reinem Baum)
    const uf = makeUF(n);
    const chosen = [];
    const degree = new Array(n).fill(0);
    for (const e of edges) {
      if (uf.find(e.a) !== uf.find(e.b)) {
        uf.union(e.a, e.b);
        chosen.push(e);
        degree[e.a]++; degree[e.b]++;
      }
    }
    for (const e of edges) {
      if (chosen.includes(e)) continue;
      const big = cities[e.a].type !== 'town' && cities[e.b].type !== 'town';
      if ((big && degree[e.a] < 4 && degree[e.b] < 4) || (degree[e.a] < 2 && degree[e.b] < 3 && e.d < maxD * 0.4)) {
        chosen.push(e);
        degree[e.a]++; degree[e.b]++;
      }
    }

    // Hauptstraßen zuerst, damit Nebenwege sich anschließen
    const isMain = (e) => cities[e.a].type !== 'town' && cities[e.b].type !== 'town';
    chosen.sort((p, q) => (isMain(q) - isMain(p)) || p.d - q.d);

    const used = new Uint8Array(g.cw * g.ch);
    const main = [], minor = [];
    const maxNodes = Math.min(g.cw * g.ch, 60000);
    for (const e of chosen) {
      const ca = cities[e.a], cb = cities[e.b];
      const path = astar(g, used, cellOf(ca), cellOf(cb), maxNodes);
      if (!path || path.length < 2) continue;
      for (const c of path) used[c] = 1;
      // Rasterpfad → Kartenkoordinaten, Endpunkte exakt an den Städten
      const pts = [ca.x, ca.y];
      for (let k = 1; k < path.length - 1; k++) {
        const c = path[k];
        pts.push((c % g.cw) * F + F / 2, ((c / g.cw) | 0) * F + F / 2);
      }
      pts.push(cb.x, cb.y);
      const smooth = FMM.Contours.chaikin(pts, 3, false);
      (isMain(e) ? main : minor).push({ pts: smooth, closed: false });
    }
    return { main, minor };
  };
})();
