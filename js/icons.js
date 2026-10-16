/* Gezeichnete Kartensymbole für Städte und Sehenswürdigkeiten (Tusche-Stil).
   Alle Symbole stehen mit ihrer Grundlinie knapp unter (x, y); s ist die Grundgröße. */
(function () {
  'use strict';
  const FMM = window.FMM;

  const PAL = {
    fantasy: { ink: '#2e2216', fill: '#f3ead2', roof: '#a4553a', stone: '#c8bfae', accent: '#b0302a', water: '#4f86b8', dark: '#3a2c20', monster: '#5c8c78', belly: '#d8cf9c', grape: '#6c3a6c', leaf: '#6f8a3c', wood: '#8a6440', sail: '#f4ecd6' },
    antique: { ink: '#3b2a18', fill: '#efe1bd', roof: '#9a6a3c', stone: '#cdbb94', accent: '#8a3a26', water: '#5f7f8c', dark: '#3b2a18', monster: '#b49e74', belly: '#e6d6ae', grape: '#6a4a3a', leaf: '#8a8456', wood: '#7a5a38', sail: '#efe1bd' },
    geo: { ink: '#1d1a16', fill: '#ffffff', roof: '#9a4a36', stone: '#c8c2b8', accent: '#b0302a', water: '#3d76a6', dark: '#2a2622', monster: '#4e7268', belly: '#cfc8a4', grape: '#5e2e5e', leaf: '#5d7d3a', wood: '#7a5634', sail: '#ffffff' },
    political: { ink: '#2a221c', fill: '#ffffff', roof: '#8a5a44', stone: '#cfc8bc', accent: '#a03a2a', water: '#4a80aa', dark: '#2a221c', monster: '#6a8a82', belly: '#e0dcc4', grape: '#6a3a5a', leaf: '#7a9058', wood: '#8a6a4a', sail: '#ffffff' },
  };
  FMM.ICON_PAL = PAL;

  // Typen der Sehenswürdigkeiten (Reihenfolge = Reihenfolge in Listen und Legende)
  FMM.POI_TYPES = {
    ruinenstadt: 'Ruinenstadt',
    burgruine: 'Burgruine',
    turm: 'Turm',
    tempel: 'Tempel',
    hoehle: 'Höhle',
    vulkan: 'Vulkan',
    wasserfall: 'Wasserfall',
    leuchtturm: 'Leuchtturm',
    schlachtfeld: 'Schlachtfeld',
  };

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
    ctx.closePath();
  }
  function shape(ctx, pts, fill, P) {
    poly(ctx, pts);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = P.ink; ctx.stroke();
  }
  // Turm mit Zinnen (b: Grundlinie, w: Breite, h: Höhe)
  function tower(ctx, cx, b, w, h, P, roof) {
    const x0 = cx - w / 2, x1 = cx + w / 2, top = b - h;
    if (roof) {
      shape(ctx, [x0, b, x0, top, x1, top, x1, b], P.fill, P);
      shape(ctx, [x0 - w * 0.12, top, cx, top - w * 1.1, x1 + w * 0.12, top], P.roof, P);
    } else {
      const m = w / 5;
      shape(ctx, [x0, b, x0, top, x0 + m, top, x0 + m, top + m, x0 + 2 * m, top + m, x0 + 2 * m, top, x0 + 3 * m, top, x0 + 3 * m, top + m, x0 + 4 * m, top + m, x0 + 4 * m, top, x1, top, x1, b], P.fill, P);
    }
  }
  function house(ctx, cx, b, w, h, P) {
    shape(ctx, [cx - w / 2, b, cx - w / 2, b - h, cx + w / 2, b - h, cx + w / 2, b], P.fill, P);
    shape(ctx, [cx - w * 0.62, b - h, cx, b - h - w * 0.62, cx + w * 0.62, b - h], P.roof, P);
  }

  const DRAW = {
    // Hauptstadt: Burg mit zwei Türmen und Fahne
    burg(ctx, x, y, s, P) {
      const b = y + s * 0.7;
      tower(ctx, x, b, s * 1.7, s * 1.1, P, false);
      tower(ctx, x - s * 0.95, b, s * 0.6, s * 1.7, P, true);
      tower(ctx, x + s * 0.95, b, s * 0.6, s * 1.7, P, true);
      // Tor
      ctx.beginPath(); ctx.moveTo(x - s * 0.22, b); ctx.lineTo(x - s * 0.22, b - s * 0.38); ctx.arc(x, b - s * 0.38, s * 0.22, Math.PI, 0); ctx.lineTo(x + s * 0.22, b); ctx.closePath();
      ctx.fillStyle = P.dark; ctx.fill();
      // Fahne
      const fx = x + s * 0.95, fy = b - s * 1.7 - s * 0.66;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - s * 0.65); ctx.strokeStyle = P.ink; ctx.stroke();
      shape(ctx, [fx, fy - s * 0.65, fx + s * 0.55, fy - s * 0.5, fx, fy - s * 0.35], P.accent, P);
    },
    // Stadt: Mauer mit Türmchen, dahinter Häuser
    stadt(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      house(ctx, x - s * 0.45, b - s * 0.45, s * 0.6, s * 0.55, P);
      house(ctx, x + s * 0.4, b - s * 0.45, s * 0.7, s * 0.75, P);
      house(ctx, x - s * 0.02, b - s * 0.4, s * 0.55, s * 0.95, P);
      tower(ctx, x, b, s * 2.0, s * 0.55, P, false);
      tower(ctx, x - s * 1.05, b, s * 0.42, s * 0.95, P, true);
      tower(ctx, x + s * 1.05, b, s * 0.42, s * 0.95, P, true);
    },
    // Dorf: zwei kleine Häuser
    dorf(ctx, x, y, s, P) {
      const b = y + s * 0.5;
      house(ctx, x + s * 0.45, b, s * 0.7, s * 0.5, P);
      house(ctx, x - s * 0.25, b, s * 0.85, s * 0.65, P);
    },
    ruinenstadt(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      shape(ctx, [x - s * 1.2, b, x - s * 1.2, b - s * 0.9, x - s * 0.9, b - s * 1.2, x - s * 0.75, b - s * 0.7, x - s * 0.4, b - s * 0.8, x - s * 0.3, b], P.stone, P);
      shape(ctx, [x - s * 0.1, b, x - s * 0.1, b - s * 1.4, x + s * 0.15, b - s * 1.1, x + s * 0.35, b - s * 1.5, x + s * 0.5, b - s * 0.9, x + s * 0.5, b], P.stone, P);
      shape(ctx, [x + s * 0.75, b, x + s * 0.8, b - s * 0.6, x + s * 1.05, b - s * 0.75, x + s * 1.2, b - s * 0.4, x + s * 1.2, b], P.stone, P);
      ctx.beginPath(); ctx.moveTo(x - s * 1.4, b); ctx.lineTo(x + s * 1.4, b); ctx.stroke();
    },
    burgruine(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      shape(ctx, [x - s * 0.45, b, x - s * 0.45, b - s * 1.5, x - s * 0.2, b - s * 1.3, x, b - s * 1.75, x + s * 0.15, b - s * 1.2, x + s * 0.45, b - s * 1.35, x + s * 0.45, b], P.stone, P);
      ctx.beginPath(); ctx.moveTo(x - s * 0.1, b - s * 0.7); ctx.lineTo(x - s * 0.1, b - s * 1.0); ctx.strokeStyle = P.ink; ctx.stroke();
      // Trümmer
      shape(ctx, [x + s * 0.6, b, x + s * 0.75, b - s * 0.25, x + s * 1.0, b - s * 0.15, x + s * 1.05, b], P.stone, P);
      shape(ctx, [x - s * 0.95, b, x - s * 0.85, b - s * 0.2, x - s * 0.6, b], P.stone, P);
    },
    turm(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      shape(ctx, [x - s * 0.38, b, x - s * 0.28, b - s * 1.8, x + s * 0.28, b - s * 1.8, x + s * 0.38, b], P.fill, P);
      shape(ctx, [x - s * 0.42, b - s * 1.8, x, b - s * 2.6, x + s * 0.42, b - s * 1.8], P.roof, P);
      ctx.fillStyle = P.dark;
      ctx.fillRect(x - s * 0.07, b - s * 1.4, s * 0.14, s * 0.26);
    },
    tempel(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      shape(ctx, [x - s * 1.1, b, x - s * 1.1, b - s * 0.18, x + s * 1.1, b - s * 0.18, x + s * 1.1, b], P.fill, P);
      for (let k = -3; k <= 3; k += 2) {
        const cx = x + k * s * 0.28;
        shape(ctx, [cx - s * 0.09, b - s * 0.18, cx - s * 0.09, b - s * 1.0, cx + s * 0.09, b - s * 1.0, cx + s * 0.09, b - s * 0.18], P.fill, P);
      }
      shape(ctx, [x - s * 1.05, b - s * 1.0, x - s * 1.05, b - s * 1.15, x + s * 1.05, b - s * 1.15, x + s * 1.05, b - s * 1.0], P.fill, P);
      shape(ctx, [x - s * 1.1, b - s * 1.15, x, b - s * 1.65, x + s * 1.1, b - s * 1.15], P.roof, P);
    },
    hoehle(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      ctx.beginPath(); ctx.moveTo(x - s * 1.3, b); ctx.quadraticCurveTo(x - s * 0.6, b - s * 1.9, x + s * 0.2, b - s * 1.5); ctx.quadraticCurveTo(x + s * 1.0, b - s * 1.2, x + s * 1.3, b); ctx.closePath();
      ctx.fillStyle = P.stone; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - s * 0.45, b); ctx.quadraticCurveTo(x - s * 0.4, b - s * 0.95, x + s * 0.05, b - s * 0.95); ctx.quadraticCurveTo(x + s * 0.5, b - s * 0.95, x + s * 0.5, b); ctx.closePath();
      ctx.fillStyle = P.dark; ctx.fill();
    },
    vulkan(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      // Rauchfahne
      ctx.fillStyle = 'rgba(120,112,104,0.55)';
      for (const [dx, dy, r] of [[0.1, 2.0, 0.32], [0.45, 2.45, 0.4], [0.95, 2.8, 0.48], [1.55, 3.0, 0.42]]) {
        ctx.beginPath(); ctx.arc(x + dx * s, b - dy * s, r * s, 0, Math.PI * 2); ctx.fill();
      }
      shape(ctx, [x - s * 1.5, b, x - s * 0.35, b - s * 1.7, x + s * 0.35, b - s * 1.7, x + s * 1.5, b], P.stone, P);
      // Schattenseite und Lava
      poly(ctx, [x + s * 0.05, b - s * 1.7, x + s * 0.35, b - s * 1.7, x + s * 1.5, b, x + s * 0.3, b]);
      ctx.fillStyle = 'rgba(70,56,44,0.35)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - s * 0.3, b - s * 1.68); ctx.lineTo(x - s * 0.15, b - s * 1.1); ctx.lineTo(x - s * 0.3, b - s * 0.6);
      ctx.strokeStyle = '#d0502a'; ctx.lineWidth *= 1.6; ctx.stroke(); ctx.lineWidth /= 1.6;
      ctx.beginPath(); ctx.ellipse(x, b - s * 1.7, s * 0.35, s * 0.1, 0, 0, Math.PI * 2); ctx.fillStyle = '#c84a24'; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
    },
    wasserfall(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      shape(ctx, [x - s * 1.2, b, x - s * 1.2, b - s * 1.4, x - s * 0.35, b - s * 1.4, x - s * 0.35, b], P.stone, P);
      shape(ctx, [x + s * 0.35, b, x + s * 0.35, b - s * 1.4, x + s * 1.2, b - s * 1.4, x + s * 1.2, b], P.stone, P);
      ctx.fillStyle = P.water;
      ctx.fillRect(x - s * 0.35, b - s * 1.4, s * 0.7, s * 1.4);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const dx of [-0.2, 0, 0.2]) { ctx.moveTo(x + dx * s, b - s * 1.3); ctx.lineTo(x + dx * s, b - s * 0.15); }
      ctx.stroke();
      ctx.strokeStyle = P.ink;
      ctx.beginPath(); ctx.arc(x - s * 0.3, b, s * 0.25, Math.PI, 0); ctx.arc(x + s * 0.3, b, s * 0.25, Math.PI, 0); ctx.stroke();
    },
    leuchtturm(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      // Lichtstrahlen
      ctx.fillStyle = 'rgba(250,220,120,0.55)';
      poly(ctx, [x, b - s * 2.0, x - s * 1.4, b - s * 2.4, x - s * 1.4, b - s * 1.75]); ctx.fill();
      poly(ctx, [x, b - s * 2.0, x + s * 1.4, b - s * 2.4, x + s * 1.4, b - s * 1.75]); ctx.fill();
      shape(ctx, [x - s * 0.4, b, x - s * 0.22, b - s * 1.8, x + s * 0.22, b - s * 1.8, x + s * 0.4, b], P.fill, P);
      ctx.fillStyle = P.accent;
      poly(ctx, [x - s * 0.36, b - s * 0.4, x - s * 0.32, b - s * 0.75, x + s * 0.32, b - s * 0.75, x + s * 0.36, b - s * 0.4]); ctx.fill();
      poly(ctx, [x - s * 0.29, b - s * 1.1, x - s * 0.26, b - s * 1.4, x + s * 0.26, b - s * 1.4, x + s * 0.29, b - s * 1.1]); ctx.fill();
      shape(ctx, [x - s * 0.25, b - s * 1.8, x - s * 0.25, b - s * 2.15, x + s * 0.25, b - s * 2.15, x + s * 0.25, b - s * 1.8], '#f6d870', P);
      shape(ctx, [x - s * 0.32, b - s * 2.15, x, b - s * 2.5, x + s * 0.32, b - s * 2.15], P.roof, P);
    },
    schlachtfeld(ctx, x, y, s, P) {
      const c = y - s * 0.5;
      ctx.strokeStyle = P.ink;
      const lw = ctx.lineWidth;
      for (const dir of [-1, 1]) {
        ctx.lineWidth = lw * 1.8;
        ctx.beginPath(); ctx.moveTo(x - dir * s * 0.95, c - s * 0.95); ctx.lineTo(x + dir * s * 0.75, c + s * 0.75); ctx.stroke();
        ctx.lineWidth = lw * 1.3;
        ctx.beginPath(); ctx.moveTo(x + dir * s * 0.45, c + s * 0.75); ctx.lineTo(x + dir * s * 0.95, c + s * 0.25); ctx.stroke();
      }
      ctx.lineWidth = lw;
    },
  };

  // ---------- Bauwerke und Meeressymbole (ohne Namen) ----------
  Object.assign(DRAW, {
    // Weiler: ein Haus mit Baum
    weiler(ctx, x, y, s, P) {
      const b = y + s * 0.5;
      ctx.beginPath(); ctx.arc(x + s * 0.55, b - s * 0.75, s * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = P.leaf; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + s * 0.55, b); ctx.lineTo(x + s * 0.55, b - s * 0.38); ctx.stroke();
      house(ctx, x - s * 0.15, b, s * 0.8, s * 0.6, P);
    },
    // Festung an einem Pass: Mauer mit zwei Türmen
    feste(ctx, x, y, s, P) {
      const b = y + s * 0.6;
      tower(ctx, x, b, s * 1.5, s * 0.75, P, false);
      tower(ctx, x - s * 0.8, b, s * 0.5, s * 1.35, P, false);
      tower(ctx, x + s * 0.8, b, s * 0.5, s * 1.35, P, false);
      ctx.fillStyle = P.dark;
      ctx.fillRect(x - s * 0.14, b - s * 0.4, s * 0.28, s * 0.4);
    },
    // Hafen: Anker
    anker(ctx, x, y, s, P) {
      const c = y - s * 0.7;
      const lw = ctx.lineWidth;
      ctx.lineWidth = lw * 1.5;
      ctx.strokeStyle = P.ink;
      ctx.beginPath(); ctx.arc(x, c - s * 0.75, s * 0.22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, c - s * 0.53); ctx.lineTo(x, c + s * 0.75);
      ctx.moveTo(x - s * 0.45, c - s * 0.25); ctx.lineTo(x + s * 0.45, c - s * 0.25);
      ctx.moveTo(x - s * 0.75, c + s * 0.15); ctx.quadraticCurveTo(x - s * 0.65, c + s * 0.8, x, c + s * 0.8);
      ctx.quadraticCurveTo(x + s * 0.65, c + s * 0.8, x + s * 0.75, c + s * 0.15);
      ctx.stroke();
      ctx.lineWidth = lw;
      ctx.fillStyle = P.ink;
      for (const d of [-1, 1]) { poly(ctx, [x + d * s * 0.75, c + s * 0.0, x + d * s * 0.95, c + s * 0.32, x + d * s * 0.58, c + s * 0.28]); ctx.fill(); }
    },
    // Mine: Stolleneingang mit Hammer und Schlägel
    mine(ctx, x, y, s, P) {
      const b = y + s * 0.5;
      ctx.beginPath(); ctx.moveTo(x - s * 1.1, b); ctx.quadraticCurveTo(x - s * 0.5, b - s * 1.3, x + s * 0.2, b - s * 1.1); ctx.quadraticCurveTo(x + s * 0.9, b - s * 0.9, x + s * 1.1, b); ctx.closePath();
      ctx.fillStyle = P.stone; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
      shape(ctx, [x - s * 0.36, b, x - s * 0.36, b - s * 0.62, x + s * 0.36, b - s * 0.62, x + s * 0.36, b], P.wood, P);
      ctx.fillStyle = P.dark; ctx.fillRect(x - s * 0.22, b - s * 0.5, s * 0.44, s * 0.5);
      // gekreuzte Werkzeuge darüber
      const c = b - s * 1.55, lw = ctx.lineWidth;
      ctx.lineWidth = lw * 1.3;
      ctx.beginPath(); ctx.moveTo(x - s * 0.5, c + s * 0.5); ctx.lineTo(x + s * 0.4, c - s * 0.4); ctx.moveTo(x + s * 0.5, c + s * 0.5); ctx.lineTo(x - s * 0.4, c - s * 0.4); ctx.stroke();
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x + s * 0.15, c - s * 0.62); ctx.quadraticCurveTo(x + s * 0.45, c - s * 0.5, x + s * 0.62, c - s * 0.15); ctx.stroke();
      poly(ctx, [x - s * 0.62, c - s * 0.32, x - s * 0.32, c - s * 0.62, x - s * 0.18, c - s * 0.48, x - s * 0.48, c - s * 0.18]); ctx.fillStyle = P.ink; ctx.fill();
    },
    // Weinberg: Traube mit Blatt
    wein(ctx, x, y, s, P) {
      const t = y - s * 1.25;
      ctx.beginPath(); ctx.moveTo(x, t - s * 0.2); ctx.lineTo(x + s * 0.1, t - s * 0.55); ctx.strokeStyle = P.ink; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + s * 0.42, t - s * 0.42, s * 0.34, s * 0.2, -0.5, 0, Math.PI * 2); ctx.fillStyle = P.leaf; ctx.fill(); ctx.stroke();
      const r = s * 0.2;
      for (const [dx, dy] of [[-0.38, 0], [0, 0], [0.38, 0], [-0.19, 0.34], [0.19, 0.34], [0, 0.68]]) {
        ctx.beginPath(); ctx.arc(x + dx * s, t + dy * s + s * 0.05, r, 0, Math.PI * 2);
        ctx.fillStyle = P.grape; ctx.fill(); ctx.stroke();
      }
    },
    // Segelschiff (Bug zeigt nach rechts)
    schiff(ctx, x, y, s, P) {
      const b = y;
      ctx.beginPath(); ctx.moveTo(x - s * 1.2, b - s * 0.45); ctx.lineTo(x + s * 1.35, b - s * 0.5);
      ctx.quadraticCurveTo(x + s * 0.9, b + s * 0.1, x + s * 0.5, b + s * 0.15); ctx.lineTo(x - s * 0.9, b + s * 0.15);
      ctx.quadraticCurveTo(x - s * 1.15, b - s * 0.1, x - s * 1.2, b - s * 0.45); ctx.closePath();
      ctx.fillStyle = P.wood; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, b - s * 0.48); ctx.lineTo(x, b - s * 2.15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - s * 0.7, b - s * 1.95); ctx.quadraticCurveTo(x - s * 0.5, b - s * 1.3, x - s * 0.72, b - s * 0.75);
      ctx.lineTo(x + s * 0.72, b - s * 0.75); ctx.quadraticCurveTo(x + s * 0.92, b - s * 1.3, x + s * 0.7, b - s * 1.95); ctx.closePath();
      ctx.fillStyle = P.sail; ctx.fill(); ctx.stroke();
      shape(ctx, [x, b - s * 2.15, x + s * 0.45, b - s * 2.02, x, b - s * 1.9], P.accent, P);
      ctx.beginPath(); ctx.moveTo(x + s * 1.35, b - s * 0.5); ctx.lineTo(x + s * 1.75, b - s * 0.75); ctx.stroke();
    },
    // Seeschlange: drei Windungen über dem Wasser, Kopf links
    seeungeheuer(ctx, x, y, s, P) {
      const b = y;
      const hump = (cx, w, hgt) => {
        ctx.beginPath();
        ctx.moveTo(cx - w, b); ctx.bezierCurveTo(cx - w, b - hgt * 1.35, cx + w, b - hgt * 1.35, cx + w, b);
        ctx.lineTo(cx + w * 0.55, b); ctx.bezierCurveTo(cx + w * 0.55, b - hgt * 0.75, cx - w * 0.55, b - hgt * 0.75, cx - w * 0.55, b);
        ctx.closePath();
        ctx.fillStyle = P.monster; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
        // Rückenkamm
        ctx.beginPath();
        for (let k = -2; k <= 2; k++) {
          const a = Math.PI / 2 + k * 0.42, px = cx + Math.cos(a) * w * 0.82 * -1, py = b - Math.sin(a) * hgt * 1.0;
          ctx.moveTo(px - s * 0.08, py); ctx.lineTo(px, py - s * 0.22); ctx.lineTo(px + s * 0.08, py);
        }
        ctx.stroke();
      };
      hump(x - s * 0.2, s * 0.62, s * 0.9);
      hump(x + s * 1.15, s * 0.5, s * 0.7);
      // Schwanzflosse
      shape(ctx, [x + s * 1.9, b, x + s * 2.25, b - s * 0.55, x + s * 2.15, b - s * 0.15, x + s * 2.5, b - s * 0.35, x + s * 2.2, b + s * 0.02], P.monster, P);
      // Hals und Kopf
      ctx.beginPath();
      ctx.moveTo(x - s * 1.25, b); ctx.quadraticCurveTo(x - s * 1.25, b - s * 1.4, x - s * 1.75, b - s * 1.55);
      ctx.lineTo(x - s * 2.35, b - s * 1.45); ctx.lineTo(x - s * 2.05, b - s * 1.2); ctx.lineTo(x - s * 2.3, b - s * 1.02);
      ctx.lineTo(x - s * 1.7, b - s * 1.08); ctx.quadraticCurveTo(x - s * 1.55, b - s * 0.6, x - s * 1.6, b);
      ctx.closePath();
      ctx.fillStyle = P.monster; ctx.fill(); ctx.strokeStyle = P.ink; ctx.stroke();
      ctx.beginPath(); ctx.arc(x - s * 1.85, b - s * 1.38, s * 0.07, 0, Math.PI * 2); ctx.fillStyle = P.ink; ctx.fill();
      // Wasserlinien
      ctx.beginPath();
      for (const [x0, x1] of [[-1.9, -1.0], [-0.95, 0.55], [0.6, 1.75], [1.8, 2.6]]) { ctx.moveTo(x + x0 * s, b + s * 0.02); ctx.quadraticCurveTo(x + (x0 + x1) / 2 * s, b + s * 0.2, x + x1 * s, b + s * 0.02); }
      ctx.strokeStyle = P.water; ctx.stroke();
    },
  });

  // Symbol zeichnen; kind: burg | stadt | dorf | Typ aus POI_TYPES | Bauwerk; flip spiegelt waagerecht
  FMM.drawIcon = function (ctx, kind, x, y, s, style, unit, flip) {
    const fn = DRAW[kind];
    if (!fn) return;
    const P = PAL[style] || PAL.fantasy;
    ctx.save();
    if (flip) { ctx.translate(2 * x, 0); ctx.scale(-1, 1); }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.35, 0.5 * unit);
    fn(ctx, x, y, s, P);
    ctx.restore();
  };
  // ungefähre Ausdehnung über der Grundlinie (für Beschriftung und Trefferflächen)
  FMM.iconExtent = { burg: [1.35, 2.9], stadt: [1.3, 1.9], dorf: [0.85, 1.3], ruinenstadt: [1.4, 1.6], burgruine: [1.05, 1.8], turm: [0.45, 2.6], tempel: [1.1, 1.7], hoehle: [1.3, 1.6], vulkan: [1.6, 2.4], wasserfall: [1.2, 1.5], leuchtturm: [0.6, 2.5], schlachtfeld: [1.0, 1.5] };
})();
