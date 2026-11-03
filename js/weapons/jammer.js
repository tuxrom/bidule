/**
 * jammer.js - Brouilleur radar : pendant 10 s, l'adversaire ne peut plus tirer d'arme neuve, ni piloter un drone,
 * ni faire sauter ses mines (la simulation refuse ses commandes `weapon`, `steer` et `detonate`). Les obus,
 * rayons, boucliers et mines déjà en place continuent leur course. Ses Bidules et ses compétences ne sont pas touchés.
 * Utile en duel seulement : il n'est donc pas dans la progression de la campagne.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const DURATION = 300;      // 10 s
  NS.Weapons.register({
    id: 'jammer', label: 'Brouilleur radar', cost: 30, cooldown: 1800, stock: 2, target: 'none',
    fire(sim, p) {
      for (const q of sim.players) if (q.id !== p.id) q.jammedUntil = sim.tick + DURATION;
      sim.emit('jam', 0, 0, p.id);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
