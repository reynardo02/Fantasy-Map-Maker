/* Landschaftsformen (Biome): Einteilung nach Temperatur, Feuchtigkeit, Höhe, Hangneigung und Flussnähe */
(function () {
  'use strict';
  const FMM = window.FMM;

  // Reihenfolge = Reihenfolge in der Legende
  const BIOMES = [
    { key: 'gletscher', name: 'Gletscher & Eis', color: [236, 241, 245] },
    { key: 'fels', name: 'Hochgebirge (Fels)', color: [138, 127, 113] },
    { key: 'tundra', name: 'Tundra', color: [152, 154, 116] },
    { key: 'taiga', name: 'Nadelwald', color: [44, 76, 54] },
    { key: 'wald', name: 'Laub- & Mischwald', color: [62, 103, 44] },
    { key: 'regenwald', name: 'Regenwald', color: [28, 84, 36] },
    { key: 'wiese', name: 'Wiesen & Grasland', color: [136, 164, 82] },
    { key: 'steppe', name: 'Steppe', color: [186, 178, 116] },
    { key: 'savanne', name: 'Savanne', color: [190, 170, 94] },
    { key: 'wueste', name: 'Wüste', color: [228, 203, 150] },
    { key: 'sumpf', name: 'Sumpf & Moor', color: [86, 100, 66] },
  ];
  const ID = {};
  BIOMES.forEach((b, i) => { ID[b.key] = i; b.id = i; });
  const FORESTS = new Uint8Array(BIOMES.length);
  FORESTS[ID.taiga] = FORESTS[ID.wald] = FORESTS[ID.regenwald] = 1;

  /**
   * t: Temperatur (inkl. Höhe), m: Feuchtigkeit 0..1, h: Höhe 0..1,
   * slope: Hangneigung (≈0 flach, ≥1 steil), rd: Abstand zum nächsten Fluss in Zellen,
   * v: großräumiges Variationsrauschen (-1..1) für natürliche, unregelmäßige Grenzen
   */
  function classify(t, m, h, slope, rd, v, fn) {
    fn = fn || 0;
    // Gletscher/Eis nur in wirklich polaren Lagen; Schnee auf Gipfeln zeichnet der Renderer über die Schneegrenze
    if (t < -0.08 + v * 0.03) return ID.gletscher;
    if (h > 0.7 + v * 0.06 || (h > 0.42 && slope > 1.5 + v * 0.3)) return ID.fels;
    // Flüsse machen ihre Umgebung feuchter (Auwälder, grüne Flusstäler); feines Rauschen franst Ränder aus
    let wet = m + v * 0.16 + fn * 0.02;
    if (rd < 5) wet += (5 - rd) * 0.045;
    if (t < 0.2) return ID.tundra;
    if (h < 0.08 && slope < 0.25 && wet > 0.76 && t > 0.3) return ID.sumpf;
    // Baumgrenze: oberhalb Almwiesen statt Wald
    if (h > 0.46 + v * 0.06 + fn * 0.02) return t < 0.3 ? ID.tundra : wet > 0.3 ? ID.wiese : ID.steppe;
    if (t < 0.45) return wet > 0.5 ? ID.taiga : wet > 0.3 ? ID.wiese : ID.steppe;
    if (t < 0.72) return wet > 0.56 ? ID.wald : wet > 0.36 ? ID.wiese : wet > 0.24 ? ID.steppe : ID.wueste;
    return wet > 0.64 ? ID.regenwald : wet > 0.44 ? ID.savanne : wet > 0.34 ? ID.steppe : ID.wueste;
  }

  FMM.BIOMES = BIOMES;
  FMM.BIOME_ID = ID;
  FMM.isForest = (id) => FORESTS[id] === 1;
  FMM.classifyBiome = classify;
})();
