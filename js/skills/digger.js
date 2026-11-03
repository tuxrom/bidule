/**
 * digger.js - Creuseur vertical : retire une rangée de 9 pixels sous ses
 * pieds toutes les 3 pas et descend d'un pixel. S'arrête sur la roche
 * indestructible, ou tombe s'il débouche dans le vide.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, M = NS.M;
  NS.Skills.register({
    id: 'digger',
    label: 'Creuseur',
    state: 'dig',
    canAssign: (b) => NS.Skills.isWorkState(b.state) && b.state !== 'dig',
    assign(b) { b.state = 'dig'; b.t = 0; },
    update(b, sim) {
      const t = sim.terrain;
      if (!t.isSolid(b.x, b.y + 1)) { NS.Physics.startFall(b); return; }
      b.t++;
      if (b.t % 3 !== 0) return;
      if (t.get(b.x, b.y + 1) === M.ROCK) {      // roche : on abandonne
        sim.emit('clink', b.x, b.y);
        b.state = 'walk'; b.t = 0;
        return;
      }
      t.carveRect(b.x - 4, b.y + 1, b.x + 4, b.y + 1);
      b.y++;
      sim.emit('dig', b.x, b.y);
      if (!t.isSolid(b.x, b.y + 1)) NS.Physics.startFall(b);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
