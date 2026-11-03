/** recon.js - Drone de reconnaissance : lève le brouillard et révèle les pièges pendant 20 s. */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  NS.Weapons.register({
    id: 'recon', label: 'Drone recon', cost: 15, cooldown: 1200, stock: 3, target: 'none',
    fire(sim, p) { p.revealUntil = sim.tick + 20 * NS.C.TICK_RATE; sim.emit('recon', p.hatch.x, p.hatch.y, p.id); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
