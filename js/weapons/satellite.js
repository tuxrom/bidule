/**
 * satellite.js - Frappe satellite : après 1,5 s de visée, un rayon perce une
 * colonne de 9 pixels de large sur toute la hauteur de la carte, roche comprise,
 * et vaporise les Bidules non protégés qui s'y trouvent. Recharge très longue.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const CHARGE = 45, HALF = 4;
  NS.Weapons.register({
    id: 'satellite', label: 'Satellite', cost: 60, cooldown: 2700, stock: 2, target: 'point', kind: 'beam',
    validate(sim, p, cmd) { return cmd.x >= 4 && cmd.x < sim.terrain.w - 4 ? null : 'Cible hors carte'; },
    fire(sim, p, cmd) { NS.Weapons.spawn(sim, 'beam', p.id, { x: cmd.x | 0, t: 0 }); sim.emit('lock', cmd.x, 0, p.id); },
    update(e, sim) {
      e.t++;
      if (e.t === CHARGE) {
        sim.terrain.carveColumn(e.x, HALF);
        for (const b of sim.bidules) {
          if (b.state !== 'rider' && Math.abs(b.x - e.x) <= HALF + 2 && !sim.shielded(b)) NS.Physics.die(b, sim, 'beam', e.owner);
        }
        sim.defuseTraps(e.x - HALF, 0, e.x + HALF, sim.terrain.h);
        sim.emit('beam', e.x, 0, e.owner);
      }
      if (e.t >= CHARGE + 25) e.dead = true;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
