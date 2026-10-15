/* Grundbausteine: Zufallszahlen, Rauschen, Prioritätswarteschlange, Hilfsfunktionen */
(function () {
  'use strict';
  const FMM = (window.FMM = window.FMM || {});

  // ---------- Deterministischer Zufall ----------
  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  FMM.makeRng = function (seed) {
    const r = mulberry32(hashString(String(seed)));
    r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
    r.range = (a, b) => a + r() * (b - a);
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    return r;
  };

  FMM.randomSeed = function () {
    const words = ['Drache', 'Nebel', 'Eiche', 'Sturm', 'Gold', 'Rabe', 'Silber', 'Mond', 'Feuer', 'Kristall', 'Wolf', 'Asche'];
    return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(Math.random() * 100000);
  };

  // Schneller Pixel-Hash (0..1) für Texturrauschen
  FMM.hash2 = function (x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // ---------- Simplex-Rauschen 2D ----------
  const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0]);
  const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1]);
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  FMM.createNoise2D = function (rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    return function (xin, yin) {
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 > 0) { const g = perm[ii + perm[jj]] & 7; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 > 0) { const g = perm[ii + i1 + perm[jj + j1]] & 7; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 > 0) { const g = perm[ii + 1 + perm[jj + 1]] & 7; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
      return 70 * n;
    };
  };

  // Fraktales Rauschen (fBm), Ergebnis grob in -1..1
  FMM.fbm = function (noise, x, y, octaves, lacunarity, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };

  // Gratrauschen für Gebirgsketten, Ergebnis 0..1
  FMM.ridged = function (noise, x, y, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(noise(x * freq, y * freq));
      n *= n;
      n *= weight;
      weight = Math.min(1, n * 2);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };

  // ---------- Binärer Min-Heap auf typisierten Arrays ----------
  FMM.MinHeap = class {
    constructor(capacity) {
      this.keys = new Float32Array(capacity);
      this.vals = new Int32Array(capacity);
      this.size = 0;
    }
    push(val, key) {
      if (this.size >= this.keys.length) this._grow();
      let i = this.size++;
      const keys = this.keys, vals = this.vals;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (keys[parent] <= key) break;
        keys[i] = keys[parent];
        vals[i] = vals[parent];
        i = parent;
      }
      keys[i] = key;
      vals[i] = val;
    }
    pop() {
      const keys = this.keys, vals = this.vals;
      const top = vals[0];
      this.topKey = keys[0];
      const n = --this.size;
      if (n > 0) {
        const key = keys[n], val = vals[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && keys[c + 1] < keys[c]) c++;
          if (keys[c] >= key) break;
          keys[i] = keys[c];
          vals[i] = vals[c];
          i = c;
        }
        keys[i] = key;
        vals[i] = val;
      }
      return top;
    }
    _grow() {
      const k = new Float32Array(this.keys.length * 2); k.set(this.keys); this.keys = k;
      const v = new Int32Array(this.vals.length * 2); v.set(this.vals); this.vals = v;
    }
  };

  // ---------- Hilfsfunktionen ----------
  FMM.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  FMM.lerp = (a, b, t) => a + (b - a) * t;
  FMM.smoothstep = function (e0, e1, x) {
    const t = FMM.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  FMM.hslToHex = function (h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
  };

  FMM.hexToRgb = function (hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };

  // Nachbarschaften (dx, dy) – 4er und 8er
  FMM.N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  FMM.N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

  FMM.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
})();
