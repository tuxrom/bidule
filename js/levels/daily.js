/**
 * daily.js
 * Défi du jour : un niveau généré à partir de la date, identique pour tout le monde ce jour-là (le générateur est
 * déterministe). La difficulté varie d'un jour à l'autre, dans le milieu de la campagne. Le classement est tenu par
 * le serveur, qui rejoue chaque replay reçu pour vérifier le score (voir server/server.js).
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  const cache = new Map();

  const Daily = {
    /** Date locale du joueur, AAAA-MM-JJ. */
    today(now) {
      const d = now || new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    valid(date) { return typeof date === 'string' && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date); },
    label(date) { const [y, m, d] = date.split('-').map(Number); return d + (d === 1 ? 'er' : '') + ' ' + MONTHS[m - 1] + ' ' + y; },

    /** Niveau du jour (mis en cache : la génération coûte quelques millisecondes). */
    def(date) {
      if (!this.valid(date)) throw new Error('date invalide');
      if (cache.has(date)) return cache.get(date);
      const h = hash('bidules-' + date);
      const d = 10 + (h % 20);                                  // difficulté 10 à 29 (niveaux 11 à 30 de la campagne)
      const W = NS.Campaign.WORLDS[(h >>> 8) % NS.Campaign.WORLDS.length];
      // Le générateur n'est garanti que sur les graines de la campagne : le robot vérifie que le plan gagne, sinon
      // on passe à la graine suivante (même suite de graines chez tout le monde, donc même niveau).
      let def = null;
      for (let k = 0; k < 12; k++) {
        def = NS.Generator.build({ id: 'daily-' + date, name: 'Défi du ' + this.label(date), world: W.id, theme: W.theme, d, seed: 100000 + ((h + k * 7919) % 900000) });
        def.daily = date;
        NS.Campaign.equip(def, d + 1);
        if (!NS.Solver || NS.Solver.solve(def).status === 'won') break;
      }
      cache.set(date, def);
      return def;
    }
  };

  NS.Daily = Daily;
})(typeof window !== 'undefined' ? window : globalThis);
