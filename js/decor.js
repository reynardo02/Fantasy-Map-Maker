/* Kartenschmuck: Meeressymbole (Wellen, Riffe, Klippen, Seeungeheuer, Schiffe), Seewege,
   Siedlungen und Bauwerke (Dörfer, Burgen an Pässen, Häfen, Brücken, Minen, Weinberge) und Mauern.
   Alles wird aus Gelände, Städten und Straßen abgeleitet (feste Saat) – nur Mauern werden gespeichert. */
(function () {
  'use strict';
  const FMM = window.FMM;

  // ---------- Belegung: Symbole sollen Städte, Orte und Beschriftungen nicht überdecken ----------
  function occupancy(map, unit) {
    const W = map.width, H = map.height;
    const S = 3 * unit, ow = Math.ceil(W / S), oh = Math.ceil(H / S);
    const g = new Uint8Array(ow * oh);
    const box = (x0, y0, x1, y1) => {
      const a = Math.max(0, Math.floor(x0 / S)), b = Math.min(ow - 1, Math.floor(x1 / S));
      const c = Math.max(0, Math.floor(y0 / S)), e = Math.min(oh - 1, Math.floor(y1 / S));
      for (let y = c; y <= e; y++) for (let x = a; x <= b; x++) g[y * ow + x] = 1;
    };
    const free = (x0, y0, x1, y1) => {
      const a = Math.max(0, Math.floor(x0 / S)), b = Math.min(ow - 1, Math.floor(x1 / S));
      const c = Math.max(0, Math.floor(y0 / S)), e = Math.min(oh - 1, Math.floor(y1 / S));
      for (let y = c; y <= e; y++) for (let x = a; x <= b; x++) if (g[y * ow + x]) return false;
      return true;
    };
    for (const c of map.cities) {
      const big = c.type === 'capital' ? 1.4 : c.type === 'city' ? 1.2 : 1;
      box(c.x - 6 * unit * big, c.y - 9 * unit * big, c.x + (8 + c.name.length * 4.2) * unit * big, c.y + 5 * unit * big);
    }
    for (const p of map.pois || []) box(p.x - 9 * unit, p.y - 13 * unit, p.x + 9 * unit, p.y + 9 * unit);
    for (const l of map.labels) {
      const s = (l.size || 14) * unit;
      if (l.path && l.path.length >= 4) {
        for (let k = 0; k < l.path.length; k += 2) box(l.path[k] - s * 0.6, l.path[k + 1] - s * 0.6, l.path[k] + s * 0.6, l.path[k + 1] + s * 0.6);
      } else {
        const w = l.text.length * s * 0.38;
        box(l.x - w, l.y - s * 0.7, l.x + w, l.y + s * 0.7);
      }
    }
    return { box, free };
  }

  // Straßen als Zellmaske (für Dörfer, Brücken)
  function roadMask(map, roads) {
    const W = map.width, H = map.height, m = new Uint8Array(W * H);
    if (!roads) return m;
    for (const r of [...roads.main, ...roads.minor]) {
      const p = r.pts;
      for (let k = 0; k < p.length; k += 2) {
        const x = p[k] | 0, y = p[k + 1] | 0;
        if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
      }
    }
    return m;
  }

  // ---------- Seewege zwischen Häfen verschiedener Landmassen ----------
  function seaRoutes(map, d, unit) {
    const W = map.width, H = map.height, h = map.heights;
    const G = Math.max(2, Math.round(4 * unit));
    const gw = Math.ceil(W / G), gh = Math.ceil(H / G), GN = gw * gh;
    const at = (gx, gy) => h[Math.min(H - 1, gy * G + (G >> 1)) * W + Math.min(W - 1, gx * G + (G >> 1))];
    const sea = new Uint8Array(GN), land = new Int32Array(GN).fill(-1);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) sea[gy * gw + gx] = at(gx, gy) < 0 ? 1 : 0;
    // Landmassen (grob) nummerieren
    let nl = 0;
    const q = new Int32Array(GN);
    for (let i = 0; i < GN; i++) {
      if (sea[i] || land[i] >= 0) continue;
      let qh = 0, qt = 0;
      q[qt++] = i; land[i] = nl;
      while (qh < qt) {
        const c = q[qh++], cx = c % gw, cy = (c / gw) | 0;
        for (const [dx, dy] of FMM.N4) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
          const n = y * gw + x;
          if (!sea[n] && land[n] < 0) { land[n] = nl; q[qt++] = n; }
        }
      }
      nl++;
    }
    // Häfen: Städte mit Meer in der Nähe
    const ports = [];
    for (const c of map.cities) {
      const gx = FMM.clamp((c.x / G) | 0, 0, gw - 1), gy = FMM.clamp((c.y / G) | 0, 0, gh - 1);
      let best = -1, bd = 1e9;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= gw || y >= gh || !sea[y * gw + x]) continue;
        const dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = y * gw + x; }
      }
      if (best < 0) continue;
      const lm = land[gy * gw + gx] >= 0 ? land[gy * gw + gx] : -1;
      ports.push({ c, cell: best, lm, rank: c.type === 'capital' ? 2 : c.type === 'city' ? 1 : 0 });
    }
    if (ports.length < 2) return { routes: [], ports };
    // je Landmasse-Paar die nächstgelegenen Häfen verbinden (Spannbaum + kurze Zusatzverbindungen)
    const lms = [...new Set(ports.map((p) => p.lm))];
    const pairs = [];
    for (let a = 0; a < lms.length; a++) {
      for (let b = a + 1; b < lms.length; b++) {
        let best = null;
        for (const p of ports) {
          if (p.lm !== lms[a]) continue;
          for (const r of ports) {
            if (r.lm !== lms[b]) continue;
            const dd = Math.hypot(p.c.x - r.c.x, p.c.y - r.c.y) - (p.rank + r.rank) * 25 * unit;
            if (!best || dd < best.d) best = { a: p, b: r, d: dd, la: a, lb: b };
          }
        }
        if (best) pairs.push(best);
      }
    }
    // innerhalb einer Landmasse: weit entfernte große Häfen (Küstenschifffahrt um Halbinseln)
    const bigPorts = ports.filter((p) => p.rank > 0);
    for (let a = 0; a < bigPorts.length; a++) {
      for (let b = a + 1; b < bigPorts.length; b++) {
        const p = bigPorts[a], r = bigPorts[b];
        if (p.lm !== r.lm) continue;
        const dd = Math.hypot(p.c.x - r.c.x, p.c.y - r.c.y);
        if (dd > 160 * unit && dd < 420 * unit) pairs.push({ a: p, b: r, d: dd * 1.6, same: true });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    const parent = lms.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const chosen = [];
    const deg = new Map();
    for (const e of pairs) {
      if (e.same) continue;
      if (find(e.la) !== find(e.lb)) { parent[find(e.la)] = find(e.lb); chosen.push(e); }
    }
    for (const e of pairs) {
      if (chosen.includes(e) || chosen.length > 14) continue;
      const da = deg.get(e.a) || 0, db = deg.get(e.b) || 0;
      if (e.d < 380 * unit && da < 2 && db < 2) chosen.push(e);
      deg.set(e.a, da + 1); deg.set(e.b, db + 1);
    }
    // Wegsuche über das Meer (leicht weg von der Küste)
    const cost = new Float32Array(GN);
    for (let i = 0; i < GN; i++) {
      if (!sea[i]) { cost[i] = Infinity; continue; }
      const x = i % gw, y = (i / gw) | 0;
      let nearLand = 0;
      for (const [dx, dy] of FMM.N8) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && !sea[yy * gw + xx]) nearLand = 1;
      }
      cost[i] = 1 + nearLand * 1.5;
    }
    const routes = [];
    for (const e of chosen) {
      const path = astar(cost, gw, gh, e.a.cell, e.b.cell, 80000);
      if (!path || path.length < 4) continue;
      const pts = [e.a.c.x, e.a.c.y];
      for (const c of path) pts.push((c % gw) * G + G / 2, ((c / gw) | 0) * G + G / 2);
      pts.push(e.b.c.x, e.b.c.y);
      routes.push({ pts: FMM.Contours.chaikin(simplify(pts, 3), 3, false), from: e.a.c.id, to: e.b.c.id });
    }
    return { routes, ports };
  }

  function astar(cost, w, h, from, to, maxNodes) {
    const N = w * h;
    const dist = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new FMM.MinHeap(1024);
    const tx = to % w, ty = (to / w) | 0;
    const est = (i) => Math.hypot((i % w) - tx, ((i / w) | 0) - ty);
    dist[from] = 0;
    heap.push(from, est(from));
    let n = 0;
    while (heap.size > 0) {
      const c = heap.pop();
      if (c === to) break;
      if (++n > maxNodes) return null;
      const cx = c % w, cy = (c / w) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + FMM.N8[k][0], ny = cy + FMM.N8[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const c2 = cost[ni];
        if (c2 === Infinity) continue;
        const nd = Math.fround(dist[c] + c2 * (k < 4 ? 1 : 1.414));
        if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = c; heap.push(ni, nd + est(ni)); }
      }
    }
    if (prev[to] < 0 && from !== to) return null;
    const path = [];
    for (let c = to; c >= 0; c = prev[c]) path.push(c);
    return path.reverse();
  }

  // Treppenpfad vom Raster ausdünnen (jeder k-te Punkt, Endpunkte bleiben)
  function simplify(p, k) {
    const n = p.length / 2, out = [p[0], p[1]];
    for (let i = k; i < n - 1; i += k) out.push(p[2 * i], p[2 * i + 1]);
    out.push(p[2 * n - 2], p[2 * n - 1]);
    return out;
  }

  // ---------- Aufbau ----------
  FMM.buildDecor = function (map, d, roads) {
    const W = map.width, H = map.height, h = map.heights, N = W * H;
    const unit = Math.min(W, H) / 750;
    const rng = FMM.makeRng(((map.settings && map.settings.seed) || 'welt') + '-deko');
    const occ = occupancy(map, unit);
    const T = d.riverThreshold;
    const temp = (i) => FMM.cellTemp(d.latT[(i / W) | 0], h[i], d.tempA[i]);
    const hash = FMM.hash2;
    const out = {
      waves: new Path2D(), reefs: new Path2D(), cliffs: new Path2D(),
      monsters: [], ships: [], settle: [], bridges: [], routes: [],
    };

    // --- Meer ---
    // Seewege und Schiffe
    const sr = seaRoutes(map, d, unit);
    out.routes = sr.routes;
    for (const r of sr.routes) {
      const p = r.pts, n = p.length / 2;
      let len = 0;
      for (let k = 1; k < n; k++) len += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
      const nShips = len > 260 * unit ? 2 : len > 90 * unit ? 1 : 0;
      for (let s = 0; s < nShips; s++) {
        const k = Math.floor(n * (nShips === 1 ? 0.5 : 0.3 + s * 0.4));
        const x = p[2 * k], y = p[2 * k + 1];
        const i = (y | 0) * W + (x | 0);
        if (h[i] >= 0 || d.coastDist[i] < 3) continue;
        const dx = p[2 * Math.min(n - 1, k + 2)] - p[2 * Math.max(0, k - 2)];
        const sz = 2.4 * unit;
        if (!occ.free(x - sz * 1.8, y - sz * 2.4, x + sz * 1.8, y + sz * 0.4)) continue;
        occ.box(x - sz * 1.8, y - sz * 2.4, x + sz * 1.8, y + sz * 0.4);
        out.ships.push({ x, y, s: sz, flip: dx < 0 });
      }
    }
    // Seeungeheuer: dort, wo das Meer am weitesten von jeder Küste entfernt ist
    const cand = [];
    const gs = Math.round(12 * unit);
    for (let y = gs; y < H - gs; y += gs) {
      for (let x = gs; x < W - gs; x += gs) {
        const i = y * W + x;
        if (x < W * 0.1 || x > W * 0.9 || y < H * 0.12 || y > H * 0.88) continue; // nicht unter Rahmen, Kompass, Kartusche
        if (h[i] < 0 && d.coastDist[i] >= 22 * unit) cand.push([x, y, d.coastDist[i] + hash(x, y) * 10]);
      }
    }
    cand.sort((a, b) => b[2] - a[2]);
    let seaCells = 0;
    for (let i = 0; i < N; i += 7) if (h[i] < 0) seaCells++;
    const nMon = Math.min(3, Math.max(seaCells * 7 > N * 0.35 ? 1 : 0, Math.round((seaCells * 7) / N * 3.2 + rng.range(-0.6, 0.6))));
    for (const l of map.labels) {
      if (!l.monster || out.monsters.length >= nMon) continue;
      const s = 8.5 * unit, x = l.x + (hash(l.x | 0, 3) - 0.5) * 20 * unit, y = l.y - 9 * unit;
      const i = (y | 0) * W + (x | 0);
      if (i < 0 || i >= N || h[i] >= 0) continue;
      occ.box(x - s * 2.8, y - s * 1.8, x + s * 2.8, y + s * 0.4);
      out.monsters.push({ x, y, s, flip: rng() < 0.5 });
    }
    for (const [x, y] of cand) {
      if (out.monsters.length >= nMon) break;
      const s = 8.5 * unit;
      if (out.monsters.some((m) => Math.hypot(m.x - x, m.y - y) < 220 * unit)) continue;
      if (!occ.free(x - s * 2.8, y - s * 1.8, x + s * 2.8, y + s * 0.4)) continue;
      occ.box(x - s * 2.8, y - s * 1.8, x + s * 2.8, y + s * 0.4);
      out.monsters.push({ x, y, s, flip: rng() < 0.5 });
    }
    // Wellen auf offener See
    const gw = Math.round(24 * unit);
    for (let gy = gw / 2; gy < H; gy += gw) {
      for (let gx = gw / 2; gx < W; gx += gw) {
        const x = gx + (hash(gx | 0, gy | 0) - 0.5) * gw * 0.8, y = gy + (hash(gy | 0, (gx | 0) + 3) - 0.5) * gw * 0.8;
        const i = (y | 0) * W + (x | 0);
        if (i < 0 || i >= N || h[i] >= 0 || d.coastDist[i] < 7 * unit || hash(x | 0, y | 0) > 0.6) continue;
        const s = (2.2 + hash((x | 0) + 9, y | 0)) * unit;
        if (!occ.free(x - s * 1.6, y - s, x + s * 1.6, y + s)) continue;
        const wv = out.waves;
        wv.moveTo(x - s * 1.5, y); wv.quadraticCurveTo(x - s * 0.75, y - s * 0.7, x, y); wv.quadraticCurveTo(x + s * 0.75, y - s * 0.7, x + s * 1.5, y);
        wv.moveTo(x - s * 0.4, y + s * 0.75); wv.quadraticCurveTo(x + s * 0.2, y + s * 0.25, x + s * 0.8, y + s * 0.75);
      }
    }
    // Riffe: flache tropische Meeresstellen
    const gr = Math.max(2, Math.round(3.2 * unit));
    for (let y = gr; y < H - gr; y += gr) {
      for (let x = gr; x < W - gr; x += gr) {
        const xx = x + ((hash(x, y + 5) - 0.5) * gr) | 0, yy = y + ((hash(y, x + 2) - 0.5) * gr) | 0;
        const i = yy * W + xx;
        if (h[i] >= -0.004 || h[i] < -0.055 || d.coastDist[i] < 2) continue;
        if (d.latT[yy] + d.tempA[i] < 0.64 || hash(xx + 1, yy * 3) > 0.42) continue;
        const r = 0.55 * unit, rf = out.reefs;
        rf.moveTo(xx - r, yy); rf.lineTo(xx + r, yy); rf.moveTo(xx, yy - r); rf.lineTo(xx, yy + r);
      }
    }
    // Klippen: Schraffen von steilen Küsten ins Meer
    const R = Math.max(2, Math.round(2.5 * unit));
    let lastX = -1e9, lastY = -1e9;
    for (let y = R + 1; y < H - R - 1; y++) {
      for (let x = R + 1; x < W - R - 1; x++) {
        const i = y * W + x;
        if (h[i] < 0 || d.coastDist[i] !== 0 || d.lake[i]) continue;
        if (hash(x * 3, y * 7) > 0.55) continue;
        let mx = 0, nx = 0, ny = 0, sea = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const v = h[i + dy * W + dx];
            if (v < 0) { nx += dx; ny += dy; sea++; } else if (v > mx) mx = v;
          }
        }
        if (mx < 0.2 || sea < 3) continue;
        if (Math.abs(x - lastX) + Math.abs(y - lastY) < 1.6 * unit) continue;
        lastX = x; lastY = y;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        const len = (1.1 + Math.min(1, (mx - 0.2) * 3)) * unit;
        out.cliffs.moveTo(x + 0.5, y + 0.5); out.cliffs.lineTo(x + 0.5 + nx * len, y + 0.5 + ny * len);
      }
    }

    // --- Siedlungen und Bauwerke ---
    const rm = roadMask(map, roads);
    const nearRoad = (x, y, r) => {
      for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && rm[yy * W + xx]) return true;
      }
      return false;
    };
    const place = (t, x, y, s, ext, force) => {
      const [ew, eh] = ext;
      if (!force && !occ.free(x - s * ew, y - s * eh, x + s * ew, y + s * 0.7)) return false;
      occ.box(x - s * ew, y - s * eh, x + s * ew, y + s * 0.7);
      out.settle.push({ t, x, y, s });
      return true;
    };
    // Brücken: wo Straßen sichtbare Flüsse queren
    if (roads) {
      for (const r of [...roads.main, ...roads.minor]) {
        const p = r.pts;
        let wasRiver = false;
        for (let k = 2; k < p.length - 2; k += 2) {
          const x = p[k], y = p[k + 1];
          const i = (y | 0) * W + (x | 0);
          const riv = d.isRiver[i] && d.flux[i] > T * 2.2 && !d.lake[i];
          if (riv && !wasRiver && !out.bridges.some((b) => Math.hypot(b.x - x, b.y - y) < 7 * unit)) {
            out.bridges.push({ x, y, a: Math.atan2(p[k + 3] - p[k - 1], p[k + 2] - p[k - 2]), main: roads.main.includes(r) });
          }
          wasRiver = riv;
        }
      }
      // Festungen an Gebirgspässen: höchster Punkt einer Straße
      for (const r of [...roads.main, ...roads.minor]) {
        const p = r.pts;
        let bi = -1, bh = 0.36;
        for (let k = 4; k < p.length - 4; k += 2) {
          const v = h[(p[k + 1] | 0) * W + (p[k] | 0)];
          if (v > bh) { bh = v; bi = k; }
        }
        if (bi < 0) continue;
        const x = p[bi], y = p[bi + 1];
        if (map.cities.some((c) => Math.hypot(c.x - x, c.y - y) < 22 * unit)) continue;
        if (out.settle.some((o) => o.t === 'feste' && Math.hypot(o.x - x, o.y - y) < 45 * unit)) continue;
        place('feste', x + 3 * unit, y - 1 * unit, 2.8 * unit, [1.2, 2.0]);
      }
    }
    // Häfen: Anker vor größeren Küstenstädten
    for (const c of map.cities) {
      if (c.type === 'town' && rng() < 0.75) continue;
      let best = null;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (let rr = 3; rr <= 9; rr++) {
          const x = c.x + Math.cos(ang) * rr * unit, y = c.y + Math.sin(ang) * rr * unit;
          const i = (y | 0) * W + (x | 0);
          if (i < 0 || i >= N || h[i] >= 0) continue;
          if (!best || rr < best.rr) best = { x, y, rr, ang };
          break;
        }
      }
      if (!best || best.rr > 7) continue;
      const x = c.x + Math.cos(best.ang) * (best.rr + 3.5) * unit, y = c.y + Math.sin(best.ang) * (best.rr + 3.5) * unit + 2 * unit;
      place('anker', x, y, 2.1 * unit, [1.0, 1.9], true); // darf an den Stadtnamen grenzen
    }
    // Dörfer und Weiler im fruchtbaren Land an Flüssen und Straßen
    const gv = Math.round(21 * unit);
    for (let gy = gv; gy < H - gv; gy += gv) {
      for (let gx = gv; gx < W - gv; gx += gv) {
        const x = gx + ((hash(gx + 1, gy + 7) - 0.5) * gv * 0.9) | 0, y = gy + ((hash(gy + 4, gx) - 0.5) * gv * 0.9) | 0;
        const i = y * W + x;
        const v = h[i];
        if (v < 0.006 || v > 0.34 || d.lake[i]) continue;
        const t = temp(i);
        if (t < 0.22 || t > 0.9) continue;
        // Trockengebiete nur an Flüssen (Oasen)
        if (map.moisture[i] < 0.33 && d.riverDist[i] > 2) continue;
        const good = d.riverDist[i] < 5 || nearRoad(x, y, Math.round(3 * unit));
        if (hash(x * 5, y + 1) > (good ? 0.55 : 0.12)) continue;
        if (map.cities.some((c) => Math.hypot(c.x - x, c.y - y) < 16 * unit)) continue;
        place(hash(x, y * 11) < 0.55 ? 'dorf' : 'weiler', x + 0.5, y + 0.5, 2.1 * unit, [1.0, 1.5]);
      }
    }
    // Minen in Hügeln und Vorgebirgen nahe Städten und Straßen, Weinberge an warmen Hängen
    const nearCity = (x, y, r) => map.cities.some((c) => Math.hypot(c.x - x, c.y - y) < r);
    const gm = Math.round(13 * unit);
    const mines = [], vines = [];
    for (let gy = gm; gy < H - gm; gy += gm) {
      for (let gx = gm; gx < W - gm; gx += gm) {
        const x = gx + ((hash(gx + 3, gy + 1) - 0.5) * gm) | 0, y = gy + ((hash(gy + 9, gx + 5) - 0.5) * gm) | 0;
        const i = y * W + x, v = h[i];
        if (v < 0 || d.lake[i]) continue;
        const r = hash(x + 13, y * 3);
        if (v > 0.3 && v < 0.56 && (nearCity(x, y, 45 * unit) || nearRoad(x, y, Math.round(8 * unit)))) mines.push([x, y, r]);
        const t = temp(i), m = map.moisture[i];
        if (v > 0.04 && v < 0.3 && t > 0.5 && t < 0.8 && m > 0.26 && m < 0.62 && nearCity(x, y, 34 * unit)) vines.push([x, y, r]);
      }
    }
    const nC = map.cities.length;
    mines.sort((a, b) => a[2] - b[2]);
    let nm = 0;
    for (const [x, y] of mines) { if (nm >= Math.max(2, Math.round(nC / 7))) break; if (place('mine', x + 0.5, y + 0.5, 2.9 * unit, [1.2, 2.3])) nm++; }
    vines.sort((a, b) => a[2] - b[2]);
    let nv = 0;
    for (const [x, y] of vines) { if (nv >= Math.max(2, Math.round(nC / 6))) break; if (place('wein', x + 0.5, y + 0.5, 3.1 * unit, [1.0, 2.0])) nv++; }
    out.settle.sort((a, b) => a.y - b.y);
    return out;
  };

  // ---------- Zeichnen ----------
  const INK = {
    fantasy: { wave: 'rgba(36,58,96,0.5)', reef: 'rgba(60,70,60,0.75)', cliff: 'rgba(52,44,34,0.85)', route: 'rgba(70,44,24,0.7)', wall: '#4a3a2a', wallFill: '#cfc4ae', bridge: '#3a2c20' },
    antique: { wave: 'rgba(70,50,30,0.55)', reef: 'rgba(70,50,30,0.8)', cliff: 'rgba(63,44,24,0.9)', route: 'rgba(70,46,24,0.8)', wall: '#3b2a18', wallFill: '#d8c8a0', bridge: '#3b2a18' },
    geo: { wave: 'rgba(230,240,250,0.45)', reef: 'rgba(220,236,228,0.8)', cliff: 'rgba(40,36,32,0.7)', route: 'rgba(250,250,245,0.75)', wall: '#2a2622', wallFill: '#b8b0a4', bridge: '#2a2622' },
    political: { wave: 'rgba(40,80,120,0.35)', reef: 'rgba(40,80,90,0.6)', cliff: 'rgba(52,66,74,0.75)', route: 'rgba(40,70,110,0.7)', wall: '#3a302a', wallFill: '#d6cec2', bridge: '#2a221c' },
  };

  FMM.drawSeaDecor = function (ctx, dec, style, unit, opts) {
    const I = INK[style] || INK.fantasy;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (opts.routes && dec.routes.length) {
      ctx.strokeStyle = I.route;
      ctx.lineWidth = 0.9 * unit;
      ctx.setLineDash([3.5 * unit, 2.5 * unit]);
      ctx.beginPath();
      for (const r of dec.routes) {
        const p = r.pts;
        ctx.moveTo(p[0], p[1]);
        for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (opts.symbols) {
      ctx.strokeStyle = I.wave;
      ctx.lineWidth = 0.55 * unit;
      ctx.stroke(dec.waves);
      ctx.strokeStyle = I.reef;
      ctx.lineWidth = 0.4 * unit;
      ctx.stroke(dec.reefs);
      ctx.strokeStyle = I.cliff;
      ctx.lineWidth = 0.45 * unit;
      ctx.stroke(dec.cliffs);
      for (const m of dec.monsters) FMM.drawIcon(ctx, 'seeungeheuer', m.x, m.y, m.s, style, unit, m.flip);
    }
    if (opts.routes || opts.symbols) for (const s of dec.ships) FMM.drawIcon(ctx, 'schiff', s.x, s.y, s.s, style, unit, s.flip);
    ctx.restore();
  };

  FMM.drawSettlements = function (ctx, dec, map, style, unit) {
    const I = INK[style] || INK.fantasy;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Mauern: Wehrgang mit Türmen
    for (const w of map.walls || []) {
      const p = w.pts;
      if (!p || p.length < 4) continue;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      ctx.strokeStyle = I.wall; ctx.lineWidth = 2.2 * unit; ctx.stroke();
      ctx.strokeStyle = I.wallFill; ctx.lineWidth = 1.2 * unit; ctx.stroke();
      ctx.setLineDash([0.6 * unit, 0.6 * unit]);
      ctx.strokeStyle = I.wall; ctx.lineWidth = 0.5 * unit; ctx.stroke();
      ctx.setLineDash([]);
      let acc = 0;
      for (let k = 2; k < p.length; k += 2) {
        acc += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
        if (acc < 11 * unit && k < p.length - 2) continue;
        acc = 0;
        const s = 1.4 * unit;
        ctx.fillStyle = I.wallFill; ctx.strokeStyle = I.wall; ctx.lineWidth = 0.45 * unit;
        ctx.fillRect(p[k] - s, p[k + 1] - s, 2 * s, 2 * s);
        ctx.strokeRect(p[k] - s, p[k + 1] - s, 2 * s, 2 * s);
      }
    }
    // Brücken: zwei Geländer quer über den Fluss
    ctx.strokeStyle = I.bridge;
    ctx.lineWidth = 0.5 * unit;
    for (const b of dec.bridges) {
      const ca = Math.cos(b.a), sa = Math.sin(b.a), L = 1.9 * unit, o = (b.main ? 1.15 : 0.9) * unit;
      ctx.beginPath();
      for (const sd of [-1, 1]) {
        const ox = -sa * o * sd, oy = ca * o * sd;
        ctx.moveTo(b.x - ca * L + ox - sa * sd * 0.5 * unit, b.y - sa * L + oy + ca * sd * 0.5 * unit);
        ctx.lineTo(b.x - ca * L * 0.6 + ox, b.y - sa * L * 0.6 + oy);
        ctx.lineTo(b.x + ca * L * 0.6 + ox, b.y + sa * L * 0.6 + oy);
        ctx.lineTo(b.x + ca * L + ox - sa * sd * 0.5 * unit, b.y + sa * L + oy + ca * sd * 0.5 * unit);
      }
      ctx.stroke();
    }
    for (const o of dec.settle) FMM.drawIcon(ctx, o.t, o.x, o.y, o.s, style, unit);
    ctx.restore();
  };

  // ---------- Schmuckbeschriftungen: „Hier sind Drachen“ in leeren Weiten ----------
  FMM.generateDecoLabels = function (map, d, rng) {
    const W = map.width, H = map.height, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const occ = occupancy(map, unit);
    const out = [];
    const fitsAt = (x, y, text, size) => {
      const w = text.length * size * unit * 0.3;
      return occ.free(x - w, y - size * unit, x + w, y + size * unit);
    };
    const add = (x, y, text, size, water, monster) => {
      const w = text.length * size * unit * 0.3;
      occ.box(x - w, y - size * unit, x + w, y + size * unit);
      out.push({ id: FMM.uid(), kind: 'deko', text, x: +x.toFixed(1), y: +y.toFixed(1), size, angle: +((rng() - 0.5) * 0.12).toFixed(3), water, monster });
    };
    const g = Math.round(10 * unit);
    const inner = (x, y) => x > W * 0.1 && x < W * 0.9 && y > H * 0.12 && y < H * 0.88;
    // Meer: am weitesten von allen Küsten entfernt
    const sea = [];
    for (let y = g; y < H - g; y += g) {
      for (let x = g; x < W - g; x += g) {
        const i = y * W + x;
        if (h[i] < 0 && inner(x, y) && d.coastDist[i] > 18 * unit) sea.push([x, y, d.coastDist[i] * (0.8 + rng() * 0.4)]);
      }
    }
    sea.sort((a, b) => b[2] - a[2]);
    const seaTexts = ['Hier sind Drachen', 'Hic sunt dracones', 'Unerforschte Gewässer', 'Das Meer der Stürme', 'Hier lauert der Leviathan'];
    for (const [x, y] of sea) {
      const text = rng.pick(seaTexts);
      if (!fitsAt(x, y, text, 10)) continue;
      add(x, y, text, 10, true, /drachen|leviathan|dracones/i.test(text));
      break;
    }
    // Land: menschenleere Weiten fern jeder Stadt
    const land = [];
    for (let y = g; y < H - g; y += g) {
      for (let x = g; x < W - g; x += g) {
        const i = y * W + x;
        if (h[i] < 0 || d.lake[i] || !inner(x, y) || d.coastDist[i] < 8 * unit) continue;
        let near = Infinity;
        for (const c of map.cities) near = Math.min(near, Math.hypot(c.x - x, c.y - y));
        if (near > 70 * unit) land.push([x, y, near * (0.8 + rng() * 0.4)]);
      }
    }
    land.sort((a, b) => b[2] - a[2]);
    let nl = 0;
    for (const [x, y] of land) {
      if (nl >= 2) break;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 180 * unit)) continue;
      const i = y * W + x, v = h[i];
      const t = FMM.cellTemp(d.latT[y], v, d.tempA[i]);
      const texts = t < 0.05 ? ['Ewiges Eis', 'Die Eiswüste', 'Land des langen Winters']
        : v > 0.5 ? ['Hier hausen Riesen', 'Die Trollberge', 'Unbezwungene Gipfel']
          : map.moisture[i] < 0.28 && t > 0.5 ? ['Das Ödland', 'Die Sengende Leere', 'Hier verdursten Karawanen']
            : ['Unerforschte Lande', 'Terra incognita', 'Wildnis', 'Hier enden die Karten'];
      const unused = texts.filter((tx) => !out.some((o) => o.text === tx));
      if (!unused.length) continue;
      const text = rng.pick(unused);
      if (!fitsAt(x, y, text, 9)) continue;
      add(x, y, text, 9, false, false);
      nl++;
    }
    return out;
  };

  // ---------- Mauern (werden bei der Generierung angelegt und gespeichert) ----------
  // Eine Mauer quer über eine schmale Landbrücke im nördlichen Teil eines großen Kontinents
  FMM.generateWalls = function (map, d, rng, names) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const comp = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    const comps = [];
    for (let i = 0; i < N; i++) {
      if (h[i] < 0 || comp[i] >= 0) continue;
      let qh = 0, qt = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      q[qt++] = i; comp[i] = comps.length;
      while (qh < qt) {
        const c = q[qh++], cx = c % W, cy = (c / W) | 0;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        for (const n of [c - 1, c + 1, c - W, c + W]) {
          if (n < 0 || n >= N || comp[n] >= 0 || h[n] < 0) continue;
          if ((n === c - 1 && cx === 0) || (n === c + 1 && cx === W - 1)) continue;
          comp[n] = comps.length; q[qt++] = n;
        }
      }
      comps.push({ size: qt, x0, x1, y0, y1 });
    }
    let best = null;
    comps.forEach((cm, id) => {
      if (cm.size < N * 0.04) return;
      const rows = new Int32Array(H);
      for (let y = cm.y0; y <= cm.y1; y++) for (let x = cm.x0; x <= cm.x1; x++) if (comp[y * W + x] === id) rows[y]++;
      let above = 0;
      for (let y = cm.y0; y <= cm.y1; y++) {
        above += rows[y];
        const frac = above / cm.size;
        if (frac < 0.1 || frac > 0.42 || y % 2) continue;
        // Landstücke dieser Zeile
        let x = cm.x0;
        while (x <= cm.x1) {
          while (x <= cm.x1 && comp[y * W + x] !== id) x++;
          const s = x;
          while (x <= cm.x1 && comp[y * W + x] === id) x++;
          const e = x - 1, len = e - s + 1;
          if (len < 34 * unit || len > (cm.x1 - cm.x0) * 0.6) continue;
          if (s <= 1 || e >= W - 2 || h[y * W + s - 1] >= 0 || h[y * W + e + 1] >= 0) continue;
          // flaches bis hügeliges Land, keine Seen
          let lakes = 0;
          for (let k = s; k <= e; k += 3) if (d.lake[y * W + k]) lakes++;
          if (lakes) continue;
          const score = len / Math.sqrt(cm.size) + d.latT[y] * 0.4;
          if (!best || score < best.score) best = { score, y, s, e };
        }
      }
    });
    if (!best || rng() > 0.65) return [];
    // Mauer folgt leicht gewellt der Zeile, die Enden reichen bis an die Küste
    const noise = FMM.createNoise2D(rng);
    const pts = [];
    const step = 4 * unit;
    for (let x = best.s - 1; x <= best.e + 1.01; x += step) {
      let y = best.y + noise(x / (40 * unit), 3.3) * 5 * unit;
      const i = Math.round(y) * W + Math.round(x);
      if (!(h[i] >= 0) && x > best.s && x < best.e) y = best.y;
      pts.push(+x.toFixed(1), +y.toFixed(1));
    }
    pts.push(best.e + 1.5, best.y);
    const culture = (() => {
      const st = map.states.find((s) => s.id === map.stateMap[best.y * W + ((best.s + best.e) >> 1)]);
      return st ? st.culture : 'germanisch';
    })();
    const n = names.name(culture);
    const name = d.latT[best.y] < 0.35 ? rng.pick(['Die Mauer', 'Die Eismauer', 'Der Nordwall', 'Die Große Mauer']) : rng.pick(['Die Große Mauer', 'Der Wall von ' + n, n + 'wall', 'Die Mauer von ' + n]);
    const wall = { id: FMM.uid(), pts, name };
    // Name nördlich der Mauer: entlang ihres Verlaufs, bei kurzen Mauern gerade darüber
    const size = 8;
    const wallLen = pts[pts.length - 2] - pts[0];
    const mid = Math.floor(pts.length / 4) * 2;
    if (name.length * size * 0.55 * unit < wallLen * 0.9) {
      const lp = [];
      for (let k = 0; k < pts.length; k += 2) lp.push(pts[k], +(pts[k + 1] - 5 * unit).toFixed(1));
      map.labels.push({ id: FMM.uid(), kind: 'region', sub: 'mauer', text: name, x: lp[mid], y: lp[mid + 1], size, path: lp, wall: wall.id });
    } else {
      // gerade über oder unter der Mauer, wo kein Stadtname im Weg ist
      const cx = (pts[0] + pts[pts.length - 2]) / 2, hw = name.length * size * 0.28 * unit;
      const hits = (y) => map.cities.some((c) => c.x + (6 + c.name.length * 4.5) * unit > cx - hw && c.x - 6 * unit < cx + hw && Math.abs(c.y - y) < 8 * unit);
      const y = [pts[mid + 1] - 6 * unit, pts[mid + 1] + 7 * unit].find((yy) => !hits(yy));
      if (y != null) map.labels.push({ id: FMM.uid(), kind: 'region', sub: 'mauer', text: name, x: +cx.toFixed(1), y: +y.toFixed(1), size, font: 'text', angle: 0, wall: wall.id });
    }
    return [wall];
  };
})();
