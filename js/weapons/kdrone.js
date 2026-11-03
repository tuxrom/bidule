/**
 * kdrone.js - Drone kamikaze piloté. Il décolle de la trappe du joueur ; la
 * commande `steer` fixe sa cible à tout moment, `detonate` le fait exploser.
 * Il explose seul au contact du terrain ou d'un Bidule adverse, ou en fin de vie.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const SPEED = 3, LIFE = 600, RADIUS = 22;
  NS.Weapons.register({
    id: 'kdrone', label: 'Drone kamikaze', cost: 25, cooldown: 750, stock: 3, target: 'pilot', kind: 'drone',
    validate(sim, p) { return sim.entities.some((e) => e.kind === 'drone' && e.owner === p.id) ? 'Un drone est déjà en vol' : null; },
    fire(sim, p, cmd) {
      const x = p.hatch.x, y = Math.max(12, p.hatch.y - 30);
      NS.Weapons.spawn(sim, 'drone', p.id, { x, y, tx: cmd.x != null ? cmd.x : x, ty: cmd.y != null ? cmd.y : y, ttl: LIFE, boom: false });
    },
    update(e, sim) {
      const t = sim.terrain;
      const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > SPEED) { e.x += (dx / d) * SPEED; e.y += (dy / d) * SPEED; } else { e.x = e.tx; e.y = e.ty; }
      e.ttl--;
      const ix = Math.round(e.x), iy = Math.round(e.y);
      let hit = e.boom || e.ttl <= 0 || t.isSolid(ix, iy);
      if (!hit) {
        for (const b of sim.bidules) {
          if (b.owner !== e.owner && b.state !== 'rider' && Math.abs(b.x - ix) <= 5 && Math.abs(b.y - 5 - iy) <= 8) { hit = true; break; }
        }
      }
      if (hit) { sim.blast(ix, iy, RADIUS, { owner: e.owner, cause: 'drone' }); e.dead = true; }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
