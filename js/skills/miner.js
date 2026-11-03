/**
 * miner.js - Mineur diagonal : cycle de 9 pas. Au pas 0 il retire un disque
 * de rayon 6 devant lui, puis descend en diagonale (45 degrés) de 3 pixels.
 * Le tunnel obtenu est praticable à pied par les Bidules qui suivent.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, C = NS.C;
  const CYCLE = 9, RADIUS = 6;
  const ROCK_ONLY = Uint8Array.from([0, 0, 1, 0, 0, 0]);   // table : seule la roche

  NS.Skills.register({
    id: 'miner',
    label: 'Mineur',
    state: 'mine',
    canAssign: (b) => NS.Skills.isWorkState(b.state) && b.state !== 'mine',
    assign(b) { b.state = 'mine'; b.t = 0; b.stuck = 0; },
    update(b, sim) {
      const t = sim.terrain;
      const ph = b.t % CYCLE;
      b.t++;
      if (ph === 0) {
        const cx = b.x + b.dir * 3, cy = b.y - 3;
        if (t.circleCount(cx, cy, RADIUS, ROCK_ONLY) > 0) {
          sim.emit('clink', b.x, b.y);           // roche indestructible : demi-tour
          b.dir = -b.dir; b.state = 'walk'; b.t = 0;
          return;
        }
        t.carveCircle(cx, cy, RADIUS);
        sim.emit('mine', cx, cy, b.dir);
      } else if (ph === 2 || ph === 5 || ph === 8) {
        const nx = b.x + b.dir, ny = b.y + 1;
        if (t.freeColumn(nx, ny, C.BODY_H)) { b.x = nx; b.y = ny; b.stuck = 0; }
        else if (++b.stuck >= 3) { b.state = 'walk'; b.t = 0; return; }
        if (ph === 8 && !t.isSolid(b.x, b.y + 1)) NS.Physics.startFall(b);
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
