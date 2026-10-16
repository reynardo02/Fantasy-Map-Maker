/* Sehenswürdigkeiten: Vulkane, Wasserfälle, Leuchttürme, Höhlen, Ruinen, Türme, Tempel, Schlachtfelder.
   Werden passend zum Gelände platziert und benannt. */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Name passend zum Typ
  FMM.poiName = function (names, type, culture) {
    const n = names.name(culture);
    const r = names.rng;
    switch (type) {
      case 'ruinenstadt': return r.pick(['Ruinen von ' + n, 'Alt-' + n, 'Das verlassene ' + n]);
      case 'burgruine': return r.pick(['Burgruine ' + n, 'Trümmer von ' + n, 'Feste ' + n]);
      case 'turm': return r.pick(['Turm von ' + n, n + 'turm', r.pick(['Der Schwarze Turm', 'Der Weiße Turm', 'Turm der Sterne', 'Der Magierturm'])]);
      case 'tempel': return r.pick(['Tempel von ' + n, 'Heiligtum von ' + n, 'Kloster ' + n]);
      case 'hoehle': return r.pick([n + 'höhle', 'Höhlen von ' + n, r.pick(['Drachenhöhle', 'Die Tiefen Hallen', 'Echohöhle'])]);
      case 'vulkan': return r.pick(['Feuerberg ' + n, n + '-Vulkan', r.pick(['Der Glutberg', 'Der Rauchende Berg', 'Drachenschlund'])]);
      case 'wasserfall': return r.pick([n + 'fälle', 'Fälle von ' + n]);
      case 'leuchtturm': return r.pick(['Leuchtfeuer von ' + n, n + '-Leuchtturm']);
      case 'schlachtfeld': return r.pick(['Schlacht von ' + n, 'Feld von ' + n, 'Blutfeld von ' + n]);
      default: return n;
    }
  };

  FMM.generatePois = function (map, d, rng) {
    const W = map.width, H = map.height, N = W * H, h = map.heights;
    const unit = Math.min(W, H) / 750;
    const scale = Math.sqrt(N / (1200 * 750));
    const used = [...map.cities.map((c) => c.name), ...map.states.map((s) => s.name), ...map.labels.map((l) => l.text)];
    const names = new FMM.NameGen(rng, used);
    const culture = (x, y) => {
      const s = map.states.find((o) => o.id === map.stateMap[(y | 0) * W + (x | 0)]);
      return s ? s.culture : 'germanisch';
    };
    const pois = [];
    const free = (x, y, cityGap) => {
      if (x < 20 * unit || y < 20 * unit || x > W - 20 * unit || y > H - 20 * unit) return false;
      if (map.cities.some((c) => Math.hypot(c.x - x, c.y - y) < cityGap * unit)) return false;
      return !pois.some((p) => Math.hypot(p.x - x, p.y - y) < 32 * unit);
    };
    const add = (type, x, y) => pois.push({ id: FMM.uid(), type, x: x + 0.5, y: y + 0.5, name: FMM.poiName(names, type, culture(x, y)) });

    // Vulkane: höchste freistehende Gipfel (lokale Maxima)
    const peaks = [];
    const st = Math.max(3, Math.round(5 * unit));
    for (let y = st; y < H - st; y += st) {
      for (let x = st; x < W - st; x += st) {
        let bi = -1, bv = 0.62;
        for (let yy = y - st; yy < y + st; yy++) for (let xx = x - st; xx < x + st; xx++) {
          const v = h[yy * W + xx];
          if (v > bv) { bv = v; bi = yy * W + xx; }
        }
        if (bi >= 0) peaks.push([bi, bv]);
      }
    }
    peaks.sort((a, b) => b[1] - a[1]);
    let nv = rng.chance(0.85) ? (rng.chance(0.4) ? 2 : 1) : 0;
    for (const [i] of peaks) {
      if (!nv) break;
      const x = i % W, y = (i / W) | 0;
      if (!free(x, y, 25) || rng.chance(0.3)) continue;
      add('vulkan', x, y); nv--;
    }

    // Wasserfälle: großer Höhensprung entlang eines Flusses mit genug Wasser
    const falls = [];
    for (const p of d.rivers) {
      for (let k = 0; k + 4 < p.length; k++) {
        const a = p[k], b = p[k + 4];
        if (h[b] < 0.04 || d.lake[a] || d.lake[b] || d.flux[a] < d.riverThreshold * 3) continue;
        const drop = h[a] - h[b];
        if (drop > 0.05) falls.push([p[k + 2], drop]);
      }
    }
    falls.sort((a, b) => b[1] - a[1]);
    let nf = Math.round((1 + rng.int(0, 1)) * scale);
    for (const [i] of falls) {
      if (!nf) break;
      const x = i % W, y = (i / W) | 0;
      if (!free(x, y, 18)) continue;
      add('wasserfall', x, y); nf--;
    }

    // Leuchttürme: Landspitzen (Küstenzelle mit viel Meer ringsum) nahe Küstenstädten
    const capes = [];
    const R = Math.max(3, Math.round(5 * unit));
    for (let y = R; y < H - R; y += 2) {
      for (let x = R; x < W - R; x += 2) {
        const i = y * W + x;
        if (h[i] < 0 || d.coastDist[i] > 1) continue;
        let sea = 0, tot = 0;
        for (let yy = -R; yy <= R; yy += 2) for (let xx = -R; xx <= R; xx += 2) { tot++; if (h[(y + yy) * W + x + xx] < 0) sea++; }
        if (sea / tot > 0.68 && map.cities.some((c) => Math.hypot(c.x - x, c.y - y) < 70 * unit)) capes.push([x, y, sea / tot]);
      }
    }
    capes.sort((a, b) => b[2] - a[2]);
    let nl = Math.round((1 + rng.int(0, 1)) * scale);
    for (const [x, y] of capes) {
      if (!nl) break;
      if (!free(x, y, 12)) continue;
      add('leuchtturm', x, y); nl--;
    }

    // übrige Orte zufällig auf passendem Gelände
    const tries = (type, count, test, cityGap) => {
      for (let t = 0, n = 0; t < 400 && n < count; t++) {
        const x = rng.int(0, W - 1), y = rng.int(0, H - 1), i = y * W + x;
        if (h[i] < 0 || d.lake[i] || !test(h[i], i) || !free(x, y, cityGap)) continue;
        add(type, x, y); n++;
      }
    };
    const c = (k) => Math.max(0, Math.round(k * scale));
    tries('hoehle', c(rng.int(1, 2)), (v) => v > 0.42 && v < 0.62, 20);
    tries('ruinenstadt', c(rng.int(1, 2)), (v) => v > 0.02 && v < 0.4, 30);
    tries('burgruine', c(rng.int(1, 2)), (v) => v > 0.12 && v < 0.5, 25);
    tries('turm', c(rng.int(1, 2)), (v) => v > 0.02 && v < 0.45, 25);
    tries('tempel', c(1), (v) => v > 0.05 && v < 0.5, 25);
    tries('schlachtfeld', c(rng.int(0, 1)), (v, i) => v > 0.01 && v < 0.25 && d.coastDist[i] > 6, 25);
    return pois;
  };
})();
