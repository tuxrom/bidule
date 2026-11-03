/**
 * mine.js - Mine télécommandée : posée au sol, elle attend l'ordre `detonate`
 * (bouton d'interface). Explosion de rayon 26 : détruit le terrain et tue les
 * Bidules non protégés, amis compris. Six mines posées au plus par joueur.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  NS.Weapons.register({
    id: 'mine', label: 'Mine', cost: 15, cooldown: 240, stock: 4, target: 'point', kind: 'mine',
    validate(sim, p, cmd) {
      if (sim.entities.filter((e) => e.kind === 'mine' && e.owner === p.id).length >= 6) return 'Six mines maximum';
      return sim.terrain.findStandable(cmd.x | 0, cmd.y | 0, 10) ? null : 'Pose impossible ici';
    },
    fire(sim, p, cmd) {
      const s = sim.terrain.findStandable(cmd.x | 0, cmd.y | 0, 10);
      NS.Weapons.spawn(sim, 'mine', p.id, { x: s.x, y: s.y });
    },
    update() { /* inerte jusqu'à detonate */ }
  });
})(typeof window !== 'undefined' ? window : globalThis);
