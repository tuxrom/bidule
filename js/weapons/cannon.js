/**
 * cannon.js - Canon César : tir en cloche, angle (5 à 85 degrés) et puissance
 * (0 à 100) réglables. L'obus est intégré en flottants avec la trigonométrie
 * déterministe de mathx.js. Cratère de rayon 30 ; les Bidules adverses touchés
 * en vol déclenchent l'impact.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const GRAV = 0.12, RADIUS = 30;
  const speed = (power) => 2.5 + power * 0.055;

  /**
   * Intègre une trajectoire : appelle `visit(x, y)` à chaque sous-pas et
   * s'arrête quand `stop(x, y)` est vrai. Sert au tir et à l'aperçu.
   */
  function fly(x, y, vx, vy, maxSteps, stop, visit) {
    for (let i = 0; i < maxSteps; i++) {
      vy += GRAV;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
      for (let k = 0; k < n; k++) {
        x += vx / n; y += vy / n;
        if (visit) visit(x, y, i);
        if (stop(Math.round(x), Math.round(y))) return { x: Math.round(x), y: Math.round(y), t: i, hit: true };
      }
    }
    return { x: Math.round(x), y: Math.round(y), t: maxSteps, hit: false };
  }

  /** Vecteur de départ d'un tir. */
  function launch(p, angle, power) {
    const v = speed(power), dir = p.cannon.dir;
    return { vx: dir * v * NS.cosDeg(angle), vy: -v * NS.sinDeg(angle) };
  }

  /** Aperçu de trajectoire (utilisé par l'interface et par l'IA). */
  function trajectory(sim, p, angle, power, visit) {
    const l = launch(p, angle, power), t = sim.terrain;
    return fly(p.cannon.x, p.cannon.y - 8, l.vx, l.vy, 500,
      (x, y) => y > t.h + 40 || x < -40 || x > t.w + 40 || t.isSolid(x, y), visit);
  }

  /**
   * Cherche l'angle et la puissance dont l'impact tombe le plus près de (tx, ty).
   * Sert à l'IA et à l'interface du joueur (toucher la carte pour viser).
   * @returns {{angle, power, d, x, y, t}|null}
   */
  function solve(sim, p, tx, ty) {
    let best = null;
    const dir = p.cannon.dir;
    // Pour chaque angle, la portée croît avec la puissance : une recherche dichotomique suffit
    // (une vingtaine d'angles x 7 essais, au lieu de tout balayer).
    for (let a = 20; a <= 78; a += 3) {
      let lo = 10, hi = 100;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) >> 1, r = trajectory(sim, p, a, mid);
        if (!r.hit) { lo = mid; continue; }
        const d = Math.abs(r.x - tx) + Math.abs(r.y - ty) * 0.5;
        if (!best || d < best.d) best = { angle: a, power: mid, d, x: r.x, y: r.y, t: r.t };
        if ((r.x - tx) * dir < 0) lo = mid; else hi = mid;
      }
    }
    return best;
  }

  NS.Weapons.register({
    id: 'cannon', label: 'Canon César', cost: 35, cooldown: 600, stock: 4, target: 'aim', kind: 'shell',
    trajectory, launch, solve,
    validate(sim, p, cmd) {
      if (!p.cannon) return 'Pas de canon sur cette carte';
      if (!(cmd.angle >= 5 && cmd.angle <= 85)) return 'Angle invalide';
      if (!(cmd.power >= 0 && cmd.power <= 100)) return 'Puissance invalide';
      return null;
    },
    fire(sim, p, cmd) {
      const l = launch(p, cmd.angle, cmd.power);
      NS.Weapons.spawn(sim, 'shell', p.id, { x: p.cannon.x, y: p.cannon.y - 8, vx: l.vx, vy: l.vy, age: 0 });
      sim.emit('cannon', p.cannon.x, p.cannon.y, p.id);
    },
    update(e, sim) {
      const t = sim.terrain;
      e.age++;
      e.vy += GRAV;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy))));
      for (let k = 0; k < n; k++) {
        e.x += e.vx / n; e.y += e.vy / n;
        const ix = Math.round(e.x), iy = Math.round(e.y);
        let hit = t.isSolid(ix, iy);
        if (!hit && e.age > 6) {
          for (const b of sim.bidules) {
            if (b.owner !== e.owner && b.state !== 'rider' && Math.abs(b.x - ix) <= 4 && Math.abs(b.y - 5 - iy) <= 7) { hit = true; break; }
          }
        }
        if (hit) { sim.blast(ix, iy, RADIUS, { owner: e.owner, cause: 'shell', lift: 16 }); e.dead = true; return; }
        if (e.x < -40 || e.x > t.w + 40 || e.y > t.h + 40) { e.dead = true; return; }
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
