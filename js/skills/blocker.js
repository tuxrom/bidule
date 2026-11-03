/**
 * blocker.js - Bloqueur : le Bidule se plante sur place, les autres font
 * demi-tour à son contact (voir Simulation.obstacleAt). Définitif.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  NS.Skills.register({
    id: 'blocker',
    label: 'Bloqueur',
    state: 'block',
    canAssign: (b) => b.state === 'walk' || b.state === 'wait',
    assign(b, sim) { b.state = 'block'; b.t = 0; },
    update(b, sim) {
      b.t++;
      // Si le sol disparaît (explosion voisine, creusement), il tombe et ne bloque plus.
      if (!sim.terrain.isSolid(b.x, b.y + 1)) NS.Physics.startFall(b);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
