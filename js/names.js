/* Namensgenerator mit verschiedenen Sprachstilen ("Kulturen") */
(function () {
  'use strict';
  const FMM = window.FMM;

  const CULTURES = {
    nordisch: {
      label: 'Nordisch',
      start: ['Thor', 'Skal', 'Hjal', 'Vin', 'Ask', 'Bjor', 'Grim', 'Hald', 'Sig', 'Ulf', 'Rag', 'Ey', 'Fros', 'Kjel', 'Sval', 'Ing', 'Tro', 'Hrafn', 'Isa', 'Vald'],
      mid: ['', '', '', 'a', 'e', 'ar', 'en', 'or', 'ul'],
      end: ['heim', 'vik', 'gard', 'fjord', 'stad', 'by', 'holm', 'dal', 'mark', 'land', 'borg', 'nes', 'havn', 'vang'],
      forms: ['Königreich', 'Jarltum', 'Königreich', 'Bund', 'Herzogtum'],
    },
    elbisch: {
      label: 'Elbisch',
      start: ['Ael', 'Cal', 'Eli', 'Gal', 'Ith', 'Lor', 'Mel', 'Nim', 'Sil', 'Thal', 'Ves', 'Ya', 'Fin', 'Ilu', 'Ara', 'Ere', 'Lin', 'Quel'],
      mid: ['a', 'e', 'i', 'an', 'ar', 'el', 'in', 'or', '', 'ith', 'ia'],
      end: ['dor', 'wen', 'las', 'ion', 'iel', 'ond', 'rien', 'thil', 'mar', 'nor', 'ost', 'duin', 'lond', 'thas'],
      forms: ['Reich', 'Königreich', 'Hohes Reich', 'Fürstentum', 'Waldreich'],
    },
    romanisch: {
      label: 'Romanisch',
      start: ['Val', 'Cor', 'Mar', 'Lu', 'Ser', 'Ter', 'Ve', 'Al', 'Ca', 'Mon', 'Por', 'Sa', 'Ost', 'Bel', 'Fer', 'Aur', 'Tav', 'Liv'],
      mid: ['a', 'i', 'o', 'e', 'an', 'er', 'in', '', '', 'ad'],
      end: ['ia', 'ona', 'ora', 'ento', 'ano', 'esa', 'ica', 'ium', 'ella', 'ara', 'ino', 'enza', 'onia', 'ar'],
      forms: ['Republik', 'Kaiserreich', 'Königreich', 'Dogat', 'Fürstentum', 'Großherzogtum'],
    },
    germanisch: {
      label: 'Germanisch',
      start: ['Ald', 'Bran', 'Eber', 'Fal', 'Hag', 'Kron', 'Lin', 'Mart', 'Ros', 'Stein', 'Wald', 'Wolf', 'Gold', 'Eich', 'Hohen', 'Neu', 'Schwarz', 'Rot', 'Hirsch', 'Adler'],
      mid: ['', '', '', 'en', 'er', 'el'],
      end: ['burg', 'berg', 'feld', 'hausen', 'stein', 'tal', 'au', 'dorf', 'furt', 'heim', 'hofen', 'wald', 'bach', 'brück', 'mark', 'eck'],
      forms: ['Herzogtum', 'Königreich', 'Grafschaft', 'Markgrafschaft', 'Freistaat', 'Kurfürstentum', 'Großherzogtum'],
    },
    orientalisch: {
      label: 'Orientalisch',
      start: ['Al', 'Ash', 'Bah', 'Dar', 'Kha', 'Mar', 'Qa', 'Sar', 'Zan', 'Ja', 'Nas', 'Tar', 'Rha', 'Sul', 'Ha', 'Ka', 'Ish', 'Me'],
      mid: ['a', 'i', 'u', 'ar', 'im', 'an', '', '', 'ah'],
      end: ['abad', 'istan', 'kand', 'pur', 'zar', 'dun', 'mir', 'shan', 'ra', 'hal', 'ar', 'esh', 'ira', 'hir'],
      forms: ['Sultanat', 'Kalifat', 'Emirat', 'Khanat', 'Großreich', 'Satrapie'],
    },
    rau: {
      label: 'Rau (Ork/Zwerg)',
      start: ['Gor', 'Kra', 'Mok', 'Ug', 'Drak', 'Zug', 'Gar', 'Thrak', 'Rok', 'Grum', 'Skar', 'Vor', 'Nar', 'Brak', 'Dur', 'Khaz', 'Bar', 'Thor'],
      mid: ['', '', 'a', 'u', 'o', 'ag', 'ul', 'im'],
      end: ['gash', 'nak', 'mor', 'dur', 'zug', 'rok', 'thar', 'grim', 'gul', 'mash', 'krag', 'oth', 'dum', 'heim'],
      forms: ['Horde', 'Klan', 'Bergkönigreich', 'Stammesland', 'Häuptlingstum'],
    },
  };

  const VOWELS = 'aeiouäöüy';

  function cleanup(name) {
    // drei gleiche Buchstaben hintereinander vermeiden
    name = name.replace(/(.)\1\1+/gi, '$1$1');
    // vier Konsonanten hintereinander vermeiden
    name = name.replace(/([^aeiouäöüy]{2})([^aeiouäöüy]{2,})/gi, (m, a, b) => a + 'e' + b);
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  function makeName(rng, culture) {
    const c = CULTURES[culture] || CULTURES.germanisch;
    for (let attempt = 0; attempt < 20; attempt++) {
      let start = rng.pick(c.start);
      let mid = rng.pick(c.mid);
      let end = rng.pick(c.end);
      // Doppelte Vokale an Silbengrenzen glätten
      if (mid && VOWELS.includes(start.slice(-1).toLowerCase()) && VOWELS.includes(mid[0])) mid = mid.slice(1);
      if (VOWELS.includes((start + mid).slice(-1).toLowerCase()) && VOWELS.includes(end[0])) {
        continue;
      }
      const name = cleanup(start + mid + end);
      if (name.length >= 4 && name.length <= 13) return name;
    }
    return cleanup(rng.pick(c.start) + rng.pick(c.end));
  }

  // Merkt sich vergebene Namen, damit es keine Duplikate gibt
  class NameGen {
    constructor(rng, used) {
      this.rng = rng;
      this.used = new Set(used || []);
    }
    name(culture) {
      for (let i = 0; i < 30; i++) {
        const n = makeName(this.rng, culture);
        if (!this.used.has(n)) { this.used.add(n); return n; }
      }
      return makeName(this.rng, culture);
    }
    stateForm(culture) {
      const c = CULTURES[culture] || CULTURES.germanisch;
      return this.rng.pick(c.forms);
    }
    seaName(culture, size) {
      const n = this.name(culture);
      if (size === 'ocean') return this.rng.pick([n + '-Ozean', 'Ozean von ' + n, 'Großes ' + n + 'meer']);
      if (size === 'sea') return this.rng.pick(['Meer von ' + n, n + 'meer', n + '-See']);
      return this.rng.pick(['Bucht von ' + n, 'Golf von ' + n, n + 'see']);
    }

    // ---------- Landschaftsnamen ----------
    // eindeutiger Name: entweder aus der Kultur abgeleitet oder beschreibend („Die Sturmzinnen“)
    landscape(culture, own, desc, nouns) {
      for (let k = 0; k < 12; k++) {
        let name;
        if (this.rng() < 0.45) {
          const [noun, art] = this.rng.pick(nouns);
          name = (art ? art + ' ' : '') + this.rng.pick(desc) + noun;
        } else {
          name = this.rng.pick(own(this.name(culture)));
        }
        if (!this.used.has(name)) { this.used.add(name); return name; }
      }
      return this.rng.pick(own(this.name(culture)));
    }
    mountainName(culture) {
      return this.landscape(culture, (n) => [n + 'gebirge', 'Die ' + adj(n) + ' Berge', n + 'kamm', 'Berge von ' + n],
        ['Frost', 'Drachen', 'Nebel', 'Schatten', 'Donner', 'Eisen', 'Grau', 'Sturm', 'Feuer', 'Mond', 'Wolken', 'Riesen'],
        [['zinnen', 'Die'], ['spitzen', 'Die'], ['gebirge', 'Das'], ['berge', 'Die'], ['kamm', 'Der'], ['grat', 'Der'], ['horn', 'Das']]);
    }
    forestName(culture) {
      return this.landscape(culture, (n) => [n + 'wald', 'Wald von ' + n, 'Der ' + adj(n) + ' Forst', n + 'hain'],
        ['Dunkel', 'Nebel', 'Schatten', 'Alt', 'Wolfs', 'Hirsch', 'Raben', 'Flüster', 'Dorn', 'Eichen', 'Elfen', 'Moos'],
        [['wald', 'Der'], ['forst', 'Der'], ['hain', 'Der'], ['tann', 'Der']]);
    }
    desertName(culture) {
      return this.landscape(culture, (n) => ['Wüste ' + n, n + '-Wüste', 'Die ' + adj(n) + ' Sande'],
        ['Rot', 'Glut', 'Sonnen', 'Salz', 'Knochen', 'Staub', 'Gold', 'Flammen'],
        [['wüste', 'Die'], ['öde', 'Die'], ['sande', 'Die']]);
    }
    swampName(culture) {
      return this.landscape(culture, (n) => [n + 'moor', 'Sümpfe von ' + n, n + 'bruch'],
        ['Nebel', 'Toten', 'Schwarz', 'Irr', 'Krähen', 'Unken', 'Faul'],
        [['moor', 'Das'], ['sumpf', 'Der'], ['marsch', 'Die'], ['fenn', 'Das']]);
    }
    lakeName(culture) {
      return this.landscape(culture, (n) => [n + 'see', 'See von ' + n, n + 'er Wasser'],
        ['Spiegel', 'Silber', 'Mond', 'Kristall', 'Schwarz', 'Nebel', 'Stern'],
        [['see', 'Der'], ['wasser', 'Das']]);
    }
    riverName(culture) {
      const n = this.name(culture);
      return this.rng.pick([n, n, n.replace(/[aeiouy]+$/i, '') + 'a', n + 'bach']);
    }
  }

  // Adjektivform eines Ortsnamens („Skalvik“ → „Skalviker“)
  function adj(n) {
    if (/er$/.test(n)) return n;
    return /e$/.test(n) ? n + 'r' : n + 'er';
  }

  FMM.CULTURES = CULTURES;
  FMM.NameGen = NameGen;
  FMM.ALL_FORMS = Array.from(new Set(Object.values(CULTURES).flatMap((c) => c.forms))).sort((a, b) => a.localeCompare(b, 'de'));
})();
