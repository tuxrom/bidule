/**
 * builder.js - Bâtisseur d'escalier : pose 12 briques de 6x2 pixels, une
 * toutes les 4 colonnes et 2 lignes de hauteur (pente 1:2), puis reprend sa
 * marche. Pendant qu'il bâtit, il compte comme un obstacle : ceux qui le
 * suivent font demi-tour au lieu de tomber au bout de l'escalier inachevé.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, M = NS.M;
  const BRICKS = 12;    // briques par escalier
  const LAY_TICKS = 8;  // durée de la pose d'une brique
  const WALK_PX = 4;    // pixels parcourus entre deux briques
  const TIRED_TICKS = 24; // pause finale (fenêtre pour enchaîner un second escalier)

  NS.Skills.register({
    id: 'builder',
    label: 'Bâtisseur',
    state: 'build',
    // Réassignable pendant la courte pause de fin (phase 2) pour enchaîner deux escaliers.
    canAssign: (b) => NS.Skills.isWorkState(b.state) && (b.state !== 'build' || b.phase === 2),
    assign(b, sim) {
      b.state = 'build'; b.bricks = BRICKS; b.phase = 0; b.t = 0; b.n = 0;
    },
    update(b, sim) {
      const t = sim.terrain;
      if (!t.isSolid(b.x, b.y + 1)) { NS.Physics.startFall(b); return; }
      b.t++;
      if (b.phase === 2) {                       // pause de fin d'escalier
        if (b.t >= TIRED_TICKS) { b.state = 'walk'; b.t = 0; }
      } else if (b.phase === 0) {                       // pose d'une brique
        if (b.t >= LAY_TICKS) {
          const xa = b.x + b.dir, xb = b.x + b.dir * 6;
          t.fillRect(Math.min(xa, xb), b.y - 1, Math.max(xa, xb), b.y, b.owner === 1 ? M.BRICK_B : M.BRICK, true);
          b.bricks--;
          sim.emit('brick', b.x + b.dir * 3, b.y);
          if (b.bricks > 0 && b.bricks <= 3) sim.emit('warn', b.x, b.y);
          b.phase = 1; b.t = 0; b.n = 0;
        }
      } else {                                   // montée sur la brique
        const r = NS.Physics.tryWalk(b, sim);
        if (r === 'moved') {
          if (++b.n >= WALK_PX) {
            if (b.bricks <= 0) { b.phase = 2; b.t = 0; }   // fatigué : courte pause
            else { b.phase = 0; b.t = 0; }
          }
        } else if (r === 'turned') { b.state = 'walk'; b.t = 0; }
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
