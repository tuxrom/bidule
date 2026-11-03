/**
 * climber.js - Grimpeur : compétence permanente. Quand il se heurte à un mur,
 * le Bidule l'escalade (1 px tous les 2 pas) jusqu'au rebord puis reprend sa
 * marche. Un plafond ou 140 pas de grimpe le font retomber et faire demi-tour.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, C = NS.C;
  NS.Skills.register({
    id: 'climber',
    label: 'Grimpeur',
    state: 'climb',
    canAssign: (b) => !b.climber && b.state !== 'dead' && b.state !== 'saved',
    assign(b) { b.climber = true; },
    update(b, sim) {
      const t = sim.terrain;
      b.t++;
      if (b.t & 1) return;
      if (++b.n > 140) { b.dir = -b.dir; NS.Physics.startFall(b); return; }
      const nx = b.x + b.dir;
      if (t.freeColumn(nx, b.y, C.BODY_H)) {                 // rebord atteint
        b.x = nx;
        let ny = b.y, d = 0;
        while (d <= C.MAX_DROP && !t.isSolid(b.x, ny + 1)) { ny++; d++; }
        if (d > C.MAX_DROP) NS.Physics.startFall(b);
        else { b.y = ny; b.state = 'walk'; b.t = 0; }
        return;
      }
      if (t.freeColumn(b.x, b.y - 1, C.BODY_H)) b.y--;
      else { b.dir = -b.dir; NS.Physics.startFall(b); }      // plafond
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
