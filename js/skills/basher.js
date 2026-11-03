/**
 * basher.js - Foreur horizontal : tous les 2 pas il retire un bloc de 3
 * colonnes devant lui sur toute sa hauteur, puis avance d'un pixel. Il
 * s'arrête quand il n'y a plus rien à creuser, et fait demi-tour sur la roche.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, C = NS.C;
  NS.Skills.register({
    id: 'basher',
    label: 'Foreur',
    state: 'bash',
    canAssign: (b) => NS.Skills.isWorkState(b.state) && b.state !== 'bash',
    assign(b) { b.state = 'bash'; b.t = 0; b.idle = 0; },
    update(b, sim) {
      const t = sim.terrain;
      if (!t.isSolid(b.x, b.y + 1)) { NS.Physics.startFall(b); return; }
      b.t++;
      if (b.t % 2 !== 0) return;
      const xa = b.x + b.dir, xb = b.x + b.dir * 3;
      const n = t.carveRect(Math.min(xa, xb), b.y - C.BODY_H + 1, Math.max(xa, xb), b.y);
      if (n > 0) { b.idle = 0; sim.emit('bash', b.x + b.dir * 2, b.y - 4, b.dir); }
      else b.idle++;
      if (t.freeColumn(b.x + b.dir, b.y, C.BODY_H)) b.x += b.dir;
      else {                                     // mur indestructible
        sim.emit('clink', b.x, b.y);
        b.dir = -b.dir; b.state = 'walk'; b.t = 0;
        return;
      }
      if (b.idle >= 16) { b.state = 'walk'; b.t = 0; }   // tunnel déjà percé
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
