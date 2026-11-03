/**
 * jetpack.js - Jetpack : le Bidule monte de 2 px/pas pendant 44 pas (88 px),
 * puis plane en avançant de 2 px/pas et en perdant 1 px tous les 2 pas.
 * Carburant : 110 pas. Il se pose s'il retrouve un sol ; carburant épuisé,
 * un parachute de secours s'ouvre (aucun dégât de chute).
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, C = NS.C;
  const FUEL = 110, CLIMB = 44;
  NS.Weapons.register({
    id: 'jetpack', label: 'Jetpack', cost: 10, cooldown: 150, stock: 5, target: 'bidule',
    validate(sim, p, cmd) {
      const b = sim.bidules.find((x) => x.id === cmd.id);
      if (!b || b.owner !== p.id) return 'Bidule introuvable';
      return (b.state === 'walk' || b.state === 'fall') ? null : 'Ce Bidule ne peut pas décoller';
    },
    fire(sim, p, cmd) {
      const b = sim.bidules.find((x) => x.id === cmd.id);
      b.state = 'jet'; b.fuel = FUEL; b.t = 0; b.floating = false; b.fallDist = 0;
      sim.emit('jet', b.x, b.y, p.id);
    }
  });

  NS.Behaviors.jet = function (b, sim) {
    const t = sim.terrain;
    b.t++; b.fuel--;
    if (b.fuel <= 0) { NS.Physics.startFall(b); b.floating = true; return; }   // parachute de secours
    if (b.t <= CLIMB) {
      for (let i = 0; i < 2; i++) if (b.y > 14 && t.freeColumn(b.x, b.y - 1, C.BODY_H)) b.y--;
    } else {
      for (let i = 0; i < 2; i++) {
        const nx = b.x + b.dir;
        if (t.freeColumn(nx, b.y, C.BODY_H)) b.x = nx;
      }
      if (b.t % 2 === 0 && !t.isSolid(b.x, b.y + 1) && t.freeColumn(b.x, b.y + 1, C.BODY_H)) b.y++;   // plané : 1 px tous les 2 pas
      if (t.isSolid(b.x, b.y + 1)) { b.state = 'walk'; b.t = 0; b.fallDist = 0; }
    }
    if (b.t % 4 === 0) sim.emit('jetpuff', b.x, b.y, b.owner);
  };
})(typeof window !== 'undefined' ? window : globalThis);
