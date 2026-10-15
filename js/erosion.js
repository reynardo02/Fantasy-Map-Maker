/* Hydraulische Erosion: simulierte Regentropfen fließen bergab, tragen Material ab
   und lagern es in flachen Bereichen, Senken und an Küsten wieder ab.
   Ergebnis: verzweigte Täler, schärfere Grate, Schwemmebenen und Schuttkegel. */
(function () {
  'use strict';
  const FMM = window.FMM;

  /**
   * heights: Float32Array (Land 0..1, Meer < 0), wird direkt verändert.
   * strength: 0..1 (Anzahl der Tropfen), rng: Zufallsfunktion
   */
  FMM.erode = function (heights, W, H, strength, rng) {
    if (!(strength > 0)) return;
    const h = heights, N = W * H;

    const P = {
      inertia: 0.06,
      capacity: 8,
      minCapacity: 0.0004,
      erodeSpeed: 0.5,
      depositSpeed: 0.3,
      evaporate: 0.025,
      gravity: 6,
      maxLife: 40,
      radius: 3,
      maxStep: 0.02, // höchstens so viel Abtrag pro Schritt (verhindert Krater)
    };

    // Pinsel für den Abtrag: Gewichte innerhalb des Radius, Summe = 1
    const bx = [], by = [], bw = [];
    let sum = 0;
    for (let dy = -P.radius; dy <= P.radius; dy++) {
      for (let dx = -P.radius; dx <= P.radius; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= P.radius) continue;
        bx.push(dx); by.push(dy); bw.push(P.radius - d);
        sum += P.radius - d;
      }
    }
    for (let k = 0; k < bw.length; k++) bw[k] /= sum;
    const boff = new Int32Array(bw.length);
    for (let k = 0; k < bw.length; k++) boff[k] = by[k] * W + bx[k];
    const BW = Float32Array.from(bw), NB = bw.length;
    const M = P.radius + 1; // Randabstand, damit der Pinsel nie über die Karte hinausreicht

    // Landzellen als Startpunkte
    const land = [];
    for (let i = 0; i < N; i++) if (h[i] > 0.005) land.push(i);
    if (!land.length) return;
    const drops = Math.round(land.length * 0.85 * strength);

    // Höhe und Gefälle an einer Position (bilinear)
    let gX = 0, gY = 0;
    const sample = (px, py) => {
      const x = px | 0, y = py | 0;
      const u = px - x, v = py - y;
      const i = y * W + x;
      const a = h[i], b = h[i + 1], c = h[i + W], d = h[i + W + 1];
      gX = (b - a) * (1 - v) + (d - c) * v;
      gY = (c - a) * (1 - u) + (d - b) * u;
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };

    for (let n = 0; n < drops; n++) {
      const start = land[Math.floor(rng() * land.length)];
      let px = (start % W) + rng(), py = ((start / W) | 0) + rng();
      let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;

      for (let life = 0; life < P.maxLife; life++) {
        if (px < M || py < M || px >= W - M - 1 || py >= H - M - 1) break;
        const nx = px | 0, ny = py | 0;
        const u = px - nx, v = py - ny;
        const ci = ny * W + nx;
        const hOld = sample(px, py);

        // Richtung: Trägheit + Gefälle
        dx = dx * P.inertia - gX * (1 - P.inertia);
        dy = dy * P.inertia - gY * (1 - P.inertia);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) break;
        dx /= len; dy /= len;
        px += dx; py += dy;
        if (px < M || py < M || px >= W - M - 1 || py >= H - M - 1) break;

        const hNew = sample(px, py);
        const dh = hNew - hOld;

        // Meer erreicht: restliches Material als Schwemmfächer ablagern
        if (hNew < 0) {
          const dep = Math.min(sediment * 0.5, 0.01);
          h[ci] += dep * (1 - u) * (1 - v); h[ci + 1] += dep * u * (1 - v);
          h[ci + W] += dep * (1 - u) * v; h[ci + W + 1] += dep * u * v;
          break;
        }

        const cap = Math.max(-dh * speed * water * P.capacity, P.minCapacity);
        if (sediment > cap || dh > 0) {
          // Ablagern: bergauf Senke füllen, sonst Überschuss absetzen
          const dep = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * P.depositSpeed;
          sediment -= dep;
          h[ci] += dep * (1 - u) * (1 - v); h[ci + 1] += dep * u * (1 - v);
          h[ci + W] += dep * (1 - u) * v; h[ci + W + 1] += dep * u * v;
        } else {
          // Abtragen mit weichem Pinsel, nie tiefer als das Gefälle und nicht unter Meeresniveau
          const amount = Math.min((cap - sediment) * P.erodeSpeed, -dh, P.maxStep);
          for (let k = 0; k < NB; k++) {
            const j = ci + boff[k];
            const hj = h[j];
            if (hj <= 0.003) continue;
            let take = amount * BW[k];
            if (take > hj - 0.003) take = hj - 0.003;
            h[j] = hj - take;
            sediment += take;
          }
        }
        speed = Math.sqrt(Math.max(0, speed * speed - dh * P.gravity));
        water *= 1 - P.evaporate;
      }
    }
  };
})();
