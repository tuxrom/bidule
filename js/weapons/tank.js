/**
 * tank.js - Char d'assaut : véhicule blindé posé au sol. Il embarque jusqu'à
 * 8 Bidules alliés qui passent près de lui, avance de 1 px/pas, laboure le
 * sable devant lui, gravit les marches jusqu'à 8 px, roule sur l'eau et la
 * lave (amphibie) et écrase les Bidules adverses. À la sortie, ses passagers
 * sont sauvés. Il abandonne ses passagers s'il reste bloqué ou après 30 s.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules, M = NS.M, SOLID = NS.SOLID;
  const CAP = 8, LIFE = 900, TH = 12;

  const hazard = (m) => m === M.WATER || m === M.LAVA;
  /** Sol pour le char : solide ou liquide mortel (il flotte dessus). */
  function ground(t, x, y) { const m = t.get(x, y); return SOLID[m] === 1 || hazard(m); }
  /** Colonne dégagée de matière solide (les liquides ne gênent pas). */
  function clear(t, x, y) {
    for (let k = 0; k < TH; k++) if (t.isSolid(x, y - k)) return false;
    return true;
  }
  function unload(e, sim) {
    for (const id of e.riders) {
      const b = sim.bidules.find((x) => x.id === id);
      if (b && b.state === 'rider') { b.state = 'walk'; b.dir = e.dir; b.t = 0; b.x = e.x; b.y = e.y; if (!sim.terrain.isSolid(b.x, b.y + 1)) NS.Physics.startFall(b); }
    }
    e.riders = [];
    e.dead = true;
  }

  NS.Weapons.register({
    id: 'tank', label: 'Char d\'assaut', cost: 45, cooldown: 1200, stock: 2, target: 'point', kind: 'tank',
    validate(sim, p, cmd) { return sim.terrain.findStandable(cmd.x | 0, cmd.y | 0, 10) ? null : 'Pose impossible ici'; },
    fire(sim, p, cmd) {
      const s = sim.terrain.findStandable(cmd.x | 0, cmd.y | 0, 10);
      NS.Weapons.spawn(sim, 'tank', p.id, { x: s.x, y: s.y, dir: p.hatch.dir || 1, riders: [], ttl: LIFE, stuck: 0 });
    },
    update(e, sim) {
      const t = sim.terrain, p = sim.players[e.owner];
      if (--e.ttl <= 0) { unload(e, sim); return; }
      for (const b of sim.bidules) {                       // embarquement et écrasement
        if (b.state === 'dead' || b.state === 'saved') continue;
        if (b.owner === e.owner) {
          if (b.state === 'walk' && e.riders.length < CAP && Math.abs(b.x - e.x) <= 9 && Math.abs(b.y - e.y) <= 6) {
            b.state = 'rider'; b.n = e.id; e.riders.push(b.id);
          }
        } else if (b.state !== 'rider' && Math.abs(b.x - e.x) <= 8 && Math.abs(b.y - e.y) <= 10) {
          NS.Physics.die(b, sim, 'crush', e.owner);
        }
      }
      if (e.riders.length === 0 && e.ttl < LIFE - 240) { e.dead = true; return; }   // personne n'est monté
      if (e.riders.length > 0) {
        const nx = e.x + e.dir;
        t.carveRect(Math.min(e.x + e.dir, nx + e.dir * 2), e.y - TH + 1, Math.max(e.x + e.dir, nx + e.dir * 2), e.y);
        let ny = -1;
        for (let k = 0; k <= 8; k++) if (clear(t, nx, e.y - k)) { ny = e.y - k; break; }
        let moved = false;
        if (ny >= 0) {
          let d = 0;
          while (d <= 3 && !ground(t, nx, ny + 1)) { ny++; d++; }
          if (d <= 3) { e.x = nx; e.y = ny; moved = true; }
        }
        e.stuck = moved ? 0 : e.stuck + 1;
        if (e.stuck > 45) { e.dir = -e.dir; if (e.stuck > 90) { unload(e, sim); return; } }
      }
      for (const id of e.riders) {                         // les passagers suivent
        const b = sim.bidules.find((x) => x.id === id);
        if (b) { b.x = e.x; b.y = e.y; }
      }
      if (Math.abs(e.x - p.exit.x) <= 10 && Math.abs(e.y - p.exit.y) <= 12 && e.riders.length) {
        for (const id of e.riders) {
          const b = sim.bidules.find((x) => x.id === id);
          if (b && b.state === 'rider') NS.Physics.save(b, sim);
        }
        e.riders = []; e.dead = true;
      }
    }
  });

  NS.Behaviors.rider = function () { /* transporté : le char le déplace */ };
})(typeof window !== 'undefined' ? window : globalThis);
