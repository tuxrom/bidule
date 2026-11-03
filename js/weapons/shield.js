/** shield.js - Bouclier énergétique : dôme de rayon 30 pendant 15 s, les Bidules dedans survivent aux explosions et aux pièges. */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  NS.Weapons.register({
    id: 'shield', label: 'Bouclier', cost: 20, cooldown: 750, stock: 3, target: 'point', kind: 'shield',
    validate(sim, p, cmd) { return cmd.x >= 0 && cmd.x < sim.terrain.w ? null : 'Cible hors carte'; },
    fire(sim, p, cmd) { NS.Weapons.spawn(sim, 'shield', p.id, { x: cmd.x | 0, y: cmd.y | 0, r: 30, ttl: 450 }); },
    update(e) { if (--e.ttl <= 0) e.dead = true; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
