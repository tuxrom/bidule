/**
 * bomber.js - Kamikaze : décompte de 5 secondes puis explosion qui détruit
 * un disque de terrain (rayon 16). Le Bidule continue son activité pendant le
 * décompte. Seul lui est détruit : l'explosion ne blesse pas les autres.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  NS.Skills.register({
    id: 'bomber',
    label: 'Kamikaze',
    state: null,
    canAssign: (b) => b.bomb === 0 && b.state !== 'dead' && b.state !== 'saved',
    assign(b, sim) { b.bomb = NS.C.BOMB_TICKS; sim.emit('ohno', b.x, b.y); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
