/**
 * zipline.js - Tyrolienne : câble tendu de A (haut) vers B (plus bas), 25 s,
 * longueur maximale 220 pixels. Les Bidules du poseur qui passent au point A
 * s'accrochent seuls et glissent à 3 px/pas, puis lâchent en B.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const MAX_LEN = 220, SPEED = 3;
  NS.Weapons.register({
    id: 'zipline', label: 'Tyrolienne', cost: 15, cooldown: 450, stock: 3, target: 'line', kind: 'zipline',
    validate(sim, p, cmd) {
      const dx = cmd.x2 - cmd.x1, dy = cmd.y2 - cmd.y1;
      if (Math.abs(dx) < 30) return 'Câble trop vertical';
      if (dy < 8) return 'L\'arrivée doit être plus basse';
      if (Math.sqrt(dx * dx + dy * dy) > MAX_LEN) return 'Câble trop long';
      return null;
    },
    fire(sim, p, cmd) {
      NS.Weapons.spawn(sim, 'zipline', p.id, { x1: cmd.x1 | 0, y1: cmd.y1 | 0, x2: cmd.x2 | 0, y2: cmd.y2 | 0, ttl: 750 });
    },
    update(e, sim) {
      if (--e.ttl <= 0) { e.dead = true; return; }
      for (const b of sim.bidules) {
        if (b.owner === e.owner && b.state === 'walk' && Math.abs(b.x - e.x1) <= 5 && Math.abs(b.y - 9 - e.y1) <= 12) {
          b.state = 'zip'; b.n = e.id; b.phase = 0; b.t = 0;
          b.dir = e.x2 > e.x1 ? 1 : -1;
        }
      }
    }
  });

  /** État "accroché au câble". */
  NS.Behaviors.zip = function (b, sim) {
    const e = sim.entities.find((x) => x.id === b.n && x.kind === 'zipline');
    if (!e) { NS.Physics.startFall(b); return; }
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx * dx + dy * dy);
    b.phase += SPEED; b.t++;
    const f = Math.min(1, b.phase / len);
    b.x = Math.round(e.x1 + dx * f);
    b.y = Math.round(e.y1 + dy * f) + 9;
    if (f >= 1) NS.Physics.startFall(b);
  };
})(typeof window !== 'undefined' ? window : globalThis);
