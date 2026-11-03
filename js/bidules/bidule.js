/**
 * bidule.js
 * Un Bidule (petit soldat-robot) et la physique commune à tous ses états :
 * marche, chute, noyade, sortie, explosion. Les états propres aux
 * compétences (creuser, bâtir...) sont dans js/skills/.
 *
 * Repère : (x, y) est le pixel des PIEDS ; le corps occupe les BODY_H lignes
 * au-dessus. Le sol est donc en (x, y + 1).
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const C = NS.C, M = NS.M;

  class Bidule {
    constructor(id, x, y, dir, owner) {
      this.id = id;
      this.owner = owner | 0;   // joueur propriétaire (0 = joueur, 1 = adversaire)
      this.x = x;
      this.y = y;
      this.dir = dir;          // 1 = vers la droite, -1 = vers la gauche
      this.state = 'fall';     // fall | walk | wait | block | build | dig | mine | bash | climb | jet | zip | grapple | rider | dead | saved
      this.t = 0;              // compteur propre à l'état (animation, cadence)
      this.fallDist = 0;       // pixels tombés depuis le dernier appui
      this.fallTicks = 0;
      this.floater = false;    // possède le parachute
      this.climber = false;    // possède la compétence grimpeur
      this.fuel = 0;           // carburant du jetpack
      this.path = null;        // trajet du grappin
      this.pi = 0;             // avancement sur ce trajet
      this.floating = false;   // parachute actuellement ouvert
      this.bomb = 0;           // compte à rebours du kamikaze (0 = inactif)
      this.bricks = 0;         // briques restantes (bâtisseur)
      this.phase = 0;          // sous-état du bâtisseur
      this.n = 0;              // compteur générique d'une compétence
      this.idle = 0;           // pas "à vide" (foreur)
      this.stuck = 0;          // blocages consécutifs (mineur)
    }
    clone() { return Object.assign(new Bidule(0, 0, 0, 1), this); }
  }

  const Physics = {
    startFall(b) {
      b.state = 'fall';
      b.fallDist = 0;
      b.fallTicks = 0;
      b.floating = false;
      b.t = 0;
    },

    /** Tue un Bidule. `by` : joueur à l'origine de la mort (pour les statistiques de frags). */
    die(b, sim, cause, by) {
      if (b.state === 'dead' || b.state === 'saved') return;
      b.state = 'dead';
      const p = sim.players[b.owner];
      p.dead++;
      p.deadBy[cause] = (p.deadBy[cause] || 0) + 1;
      if (by !== undefined && by >= 0 && by !== b.owner) sim.players[by].stats.kills++;
      sim.emit('die', b.x, b.y, cause);
    },

    save(b, sim) {
      b.state = 'saved';
      sim.players[b.owner].saved++;
      sim.emit('saved', b.x, b.y, b.owner);
    },

    explode(b, sim) {
      sim.terrain.carveCircle(b.x, b.y, C.BOMB_RADIUS, sim.rng);
      sim.emit('explode', b.x, b.y - 3, 16);
      this.die(b, sim, 'explode', b.owner);
    },

    /** Éjecte un Bidule coincé dans la matière (brique posée sur lui, par exemple). */
    unstick(b, sim) {
      const t = sim.terrain;
      if (t.freeColumn(b.x, b.y, C.BODY_H)) return;
      for (let k = 1; k <= 12; k++) {
        if (t.freeColumn(b.x, b.y - k, C.BODY_H)) { b.y -= k; return; }
      }
    },

    /**
     * Avance d'un pixel dans la direction du Bidule en suivant le relief :
     * monte une marche (<= MAX_CLIMB), descend une pente (<= MAX_DROP),
     * sinon tombe. Un mur ou un obstacle (bloqueur) fait demi-tour.
     * @returns {'moved'|'turned'|'fell'}
     */
    tryWalk(b, sim) {
      const t = sim.terrain;
      const nx = b.x + b.dir;
      const obs = sim.obstacleAt(b, nx);
      if (obs) {
        if (obs.state !== 'block') { b.state = 'wait'; b.n = b.dir; b.t = 0; return 'wait'; }
        b.dir = -b.dir;
        return 'turned';
      }
      let ny = -1;
      for (let k = 0; k <= C.MAX_CLIMB; k++) {
        if (t.freeColumn(nx, b.y - k, C.BODY_H)) { ny = b.y - k; break; }
      }
      if (ny < 0) {
        if (b.climber) { b.state = 'climb'; b.t = 0; b.n = 0; return 'climb'; }   // le grimpeur escalade
        b.dir = -b.dir;
        return 'turned';
      }
      let d = 0;
      while (d <= C.MAX_DROP && !t.isSolid(nx, ny + 1)) { ny++; d++; }
      if (d > C.MAX_DROP) {      // plus de sol : on passe le bord et on tombe
        b.x = nx;
        this.startFall(b);
        return 'fell';
      }
      b.x = nx;
      b.y = ny;
      return 'moved';
    },

    /** Un pas de simulation complet pour un Bidule. */
    update(b, sim) {
      if (b.bomb > 0) {
        b.bomb--;
        if (b.bomb === 0) { this.explode(b, sim); return; }
      }
      const fn = NS.Behaviors[b.state];
      if (fn) fn(b, sim);
      if (b.state === 'dead' || b.state === 'saved' || b.state === 'rider') return;

      const t = sim.terrain;
      // Sorti de la carte : perdu.
      if (b.x < 0 || b.x >= t.w || b.y >= t.h + 8) { this.die(b, sim, 'oob'); return; }
      // Eau et lave au niveau des pieds.
      const m = t.get(b.x, b.y);
      if (m === M.WATER) { this.die(b, sim, 'drown'); return; }
      if (m === M.LAVA) { this.die(b, sim, 'burn'); return; }
      // Porte de sortie.
      if (b.state !== 'block' && sim.inExit(b)) this.save(b, sim);
    }
  };

  /* ------------------------------ États de base ------------------------------ */

  NS.Behaviors.walk = function (b, sim) {
    b.t++;
    Physics.unstick(b, sim);
    if (!sim.terrain.isSolid(b.x, b.y + 1)) { Physics.startFall(b); return; }
    Physics.tryWalk(b, sim);
  };

  /**
   * Attente derrière un bâtisseur, foreur ou mineur : le Bidule reste en place tant qu'un ouvrier
   * du même camp travaille devant lui à moins de 12 pixels, puis reprend sa marche
   * (il suit ainsi l'escalier à distance, sans jamais dépasser le bâtisseur).
   */
  NS.Behaviors.wait = function (b, sim) {
    b.t++;
    if (!sim.terrain.isSolid(b.x, b.y + 1)) { Physics.startFall(b); return; }
    // File d'attente : deux Bidules qui attendent au même endroit s'écartent de 3 pixels (le plus récent recule),
    // pour qu'une grappe ne se jette pas d'un seul bloc dans un gouffre et ne meure pas sous une seule explosion.
    for (const o of sim.bidules) {
      if (o === b || o.owner !== b.owner || o.state !== 'wait' || o.id > b.id || Math.abs(o.y - b.y) > 3 || Math.abs(o.x - b.x) > 2) continue;
      const bx = b.x - b.n;
      if (sim.terrain.freeColumn(bx, b.y, NS.C.BODY_H) && sim.terrain.isSolid(bx, b.y + 1)) b.x = bx;
      break;
    }
    for (const o of sim.obstacles) {
      if (o.owner !== b.owner || o.state === 'block' || o === b || Math.abs(o.y - b.y) > 30) continue;
      const ahead = (o.x - b.x) * b.n;
      if (ahead >= -1 && ahead <= 12) return;
    }
    b.state = 'walk'; b.dir = b.n; b.t = 0;
  };

  NS.Behaviors.fall = function (b, sim) {
    const t = sim.terrain;
    b.fallTicks++;
    // Parachute : s'ouvre automatiquement après FLOAT_START pixels de chute.
    const opening = b.floater && !b.floating && b.fallDist >= C.FLOAT_START;
    if (opening) { b.floating = true; sim.emit('chute', b.x, b.y); }
    const vy = b.floating ? 1 : (b.fallTicks < 6 ? 1 : b.fallTicks < 14 ? 2 : 3);
    for (let i = 0; i < vy; i++) {
      if (t.isSolid(b.x, b.y + 1)) {
        if (!b.floating && b.fallDist > C.FATAL_FALL) { Physics.die(b, sim, 'splat', -1); return; }
        b.state = 'walk';
        b.floating = false;
        b.fallDist = 0;
        b.t = 0;
        return;
      }
      b.y++;
      b.fallDist++;
      const m = t.get(b.x, b.y);
      if (m === M.WATER) { Physics.die(b, sim, 'drown', -1); return; }
      if (m === M.LAVA) { Physics.die(b, sim, 'burn', -1); return; }
    }
  };

  NS.Bidule = Bidule;
  NS.Physics = Physics;
})(typeof window !== 'undefined' ? window : globalThis);
