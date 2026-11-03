/**
 * campaign.js
 * Campagne solo de 40 niveaux en 4 univers, progression des armes, étoiles et
 * sauvegarde. Les trois premiers niveaux du désert sont écrits à la main
 * (level1 à level3) ; les 37 autres sont générés de façon déterministe par
 * generator.js, avec une difficulté croissante.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  const WORLDS = [
    { id: 'desert', name: 'Désert des mirages', theme: 'desert', prefix: 'Dune' },
    { id: 'ruins', name: 'Ville en ruines', theme: 'ruins', prefix: 'Quartier' },
    { id: 'arctic', name: 'Base arctique', theme: 'arctic', prefix: 'Banquise' },
    { id: 'orbital', name: 'Station orbitale', theme: 'orbital', prefix: 'Secteur' }
  ];
  const PER_WORLD = 10;

  /**
   * Numéro de niveau (à partir de 1) auquel chaque équipement est débloqué.
   * Ce tableau est la seule source de vérité de la progression.
   */
  const UNLOCK = {
    climber: 4, recon: 5, mine: 8,
    kdrone: 11, cannon: 13, shield: 15, jetpack: 18,
    zipline: 21, grapple: 23, tank: 26,
    satellite: 31
  };

  let cache = null;

  /** Ajoute à un niveau les armes débloquées à son rang et les points. */
  function equip(def, rank) {
    def.rank = rank;
    def.weapons = {};
    for (const w of NS.Weapons.list) if (UNLOCK[w.id] && rank >= UNLOCK[w.id]) def.weapons[w.id] = w.stock;
    def.points = { start: 100, regen: 1 };
    if (def.skills && UNLOCK.climber && rank >= UNLOCK.climber) def.skills.climber = 3;
    if (!def.cannon) def.cannon = { x: 50, y: def.hatch.y + 29, dir: 1 };
    return def;
  }

  function all() {
    if (cache) return cache;
    cache = [];
    for (let w = 0; w < WORLDS.length; w++) {
      for (let i = 0; i < PER_WORLD; i++) {
        const idx = w * PER_WORLD + i, W = WORLDS[w];
        let def;
        if (idx < NS.Loader.levels.length) {            // niveaux écrits à la main
          def = JSON.parse(JSON.stringify(NS.Loader.levels[idx]));
          def.name = def.name;
        } else {
          def = NS.Generator.build({ id: W.id + '-' + (i + 1), name: W.prefix + ' ' + (i + 1), world: W.id, theme: W.theme, d: idx, seed: 7000 + idx * 97 });
        }
        def.world = W.id; def.theme = W.theme; def.index = idx;
        cache.push(equip(def, idx + 1));
      }
    }
    return cache;
  }

  /**
   * Étoiles (1 à 3) d'une partie solo terminée :
   *  1 étoile : objectif atteint ;
   *  2 étoiles : au moins objectif + 20 points de pourcentage sauvés ;
   *  3 étoiles : au moins objectif + 35 points, en moins de 75 % du temps.
   */
  function stars(sim) {
    const p = sim.players[0];
    if (sim.status !== 'won') return 0;
    const pct = (p.saved * 100) / p.count;
    let s = 1;
    if (pct >= Math.min(100, p.goal + 20)) s = 2;
    if (s === 2 && pct >= Math.min(100, p.goal + 35) && sim.tick <= sim.timeLimitTicks * 0.75) s = 3;
    return s;
  }

  /* -------------------------------- Sauvegarde ------------------------------- */

  const KEY = 'bidules.save.v2';
  const Save = {
    data: { levels: {}, vs: { played: 0, won: 0, byDifficulty: {} } },
    load() {
      try {
        const raw = G.localStorage && G.localStorage.getItem(KEY);
        if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (e) { /* stockage indisponible : on joue sans sauvegarde */ }
      return this.data;
    },
    store() { try { G.localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignoré */ } },
    levelStars(id) { return (this.data.levels[id] && this.data.levels[id].stars) || 0; },
    /** Enregistre un résultat ; renvoie vrai si c'est un record d'étoiles. */
    record(id, starCount, pct) {
      const cur = this.data.levels[id] || { stars: 0, best: 0 };
      const better = starCount > cur.stars;
      this.data.levels[id] = { stars: Math.max(cur.stars, starCount), best: Math.max(cur.best, pct) };
      this.store();
      return better;
    },
    recordVS(difficulty, won) {
      const v = this.data.vs;
      v.played++; if (won) v.won++;
      const d = v.byDifficulty[difficulty] || { played: 0, won: 0 };
      d.played++; if (won) d.won++;
      v.byDifficulty[difficulty] = d;
      this.store();
    },
    /** Un niveau est jouable si le précédent est terminé (ou s'il est le premier de la campagne). */
    unlocked(index) {
      if (index === 0) return true;
      return this.levelStars(all()[index - 1].id) >= 1;
    },
    totalStars() { return Object.values(this.data.levels).reduce((s, l) => s + l.stars, 0); },
    reset() { this.data = { levels: {}, vs: { played: 0, won: 0, byDifficulty: {} } }; this.store(); }
  };

  NS.Campaign = { WORLDS, PER_WORLD, UNLOCK, all, stars, Save, equip };
})(typeof window !== 'undefined' ? window : globalThis);
