/**
 * grapple.js - Grappin : le Bidule désigné est tiré vers un point d'ancrage
 * (portée 110 px) en deux segments, vertical puis horizontal si la cible est
 * plus haute, l'inverse sinon. Chaque point du trajet doit être libre : le
 * grappin franchit un gouffre ou escalade une falaise, pas un mur.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, C = NS.C;
  const RANGE = 110, SPEED = 3;

  function legs(a, b, vFirst) {
    const pts = [];
    const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    let x = a.x, y = a.y;
    const goV = () => { while (y !== b.y) { y += sy; pts.push([x, y]); } };
    const goH = () => { while (x !== b.x) { x += sx; pts.push([x, y]); } };
    if (vFirst) { goV(); goH(); } else { goH(); goV(); }
    return pts;
  }

  /** Calcule un trajet libre jusqu'à la cible, ou null. */
  function plan(sim, b, x, y) {
    const t = sim.terrain;
    const spot = t.findStandable(x | 0, y | 0, 12);
    if (!spot) return null;
    if (Math.abs(spot.x - b.x) + Math.abs(spot.y - b.y) > RANGE) return null;
    for (const vFirst of [spot.y < b.y, spot.y >= b.y]) {
      const path = legs({ x: b.x, y: b.y }, spot, vFirst);
      if (path.length && path.every(([px, py]) => t.freeColumn(px, py, C.BODY_H))) return { path, spot };
    }
    return null;
  }

  NS.Weapons.register({
    id: 'grapple', label: 'Grappin', cost: 10, cooldown: 150, stock: 5, target: 'bidule-point', plan,
    validate(sim, p, cmd) {
      const b = sim.bidules.find((x) => x.id === cmd.id);
      if (!b || b.owner !== p.id) return 'Bidule introuvable';
      if (b.state !== 'walk') return 'Ce Bidule ne peut pas s\'accrocher';
      return plan(sim, b, cmd.x, cmd.y) ? null : 'Ancrage impossible ici';
    },
    fire(sim, p, cmd) {
      const b = sim.bidules.find((x) => x.id === cmd.id);
      const r = plan(sim, b, cmd.x, cmd.y);
      b.state = 'grapple'; b.path = r.path; b.pi = 0; b.t = 0;
      b.dir = r.spot.x >= b.x ? 1 : -1;
      sim.emit('grapple', r.spot.x, r.spot.y, p.id);
    }
  });

  NS.Behaviors.grapple = function (b, sim) {
    b.t++;
    b.pi += SPEED;
    if (b.pi >= b.path.length) {
      const last = b.path[b.path.length - 1];
      b.x = last[0]; b.y = last[1]; b.path = null;
      if (sim.terrain.isSolid(b.x, b.y + 1)) { b.state = 'walk'; b.t = 0; } else NS.Physics.startFall(b);
      return;
    }
    b.x = b.path[b.pi][0]; b.y = b.path[b.pi][1];
  };
})(typeof window !== 'undefined' ? window : globalThis);
