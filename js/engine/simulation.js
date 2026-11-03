/**
 * simulation.js
 * Cœur du jeu : état du monde et avancement par pas FIXES (30 Hz).
 *
 * Règles de conception, pensées pour le multijoueur futur (verrouillage des
 * pas / lockstep) :
 *  - aucune dépendance au DOM, au temps réel ni à Math.random() ;
 *  - toute action est une COMMANDE sérialisable {tick, player, type, ...} ;
 *    état initial + graine + journal de commandes = partie reproductible ;
 *  - le joueur humain et l'IA passent par les mêmes commandes (issue()) ;
 *  - l'ordre de mise à jour est celui des tableaux (stable) ;
 *  - la simulation ne dessine rien : elle publie des événements (sons,
 *    particules) que le rendu et l'audio consomment.
 *
 * Plusieurs armées : `players[i]` porte tout ce qui est propre à un camp
 * (trappe, sortie, stocks, points, recharges). Un niveau solo n'a qu'un joueur ;
 * les accesseurs `saved`, `skills`, `rate`... pointent vers le joueur 0 pour
 * rester compatibles avec le prototype.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const C = NS.C;
  const VISION = 90;           // rayon de vision d'un Bidule, d'une trappe ou d'une sortie (brouillard)
  const MAX_POINTS = 999;

  /** Construit l'état d'un joueur depuis sa configuration de niveau. */
  function makePlayer(cfg, i) {
    const weapons = {};
    for (const id of Object.keys(cfg.weapons || {})) weapons[id] = { stock: cfg.weapons[id] | 0, cd: 0 };
    const pts = cfg.points || { start: 100, regen: 1 };
    const rate = cfg.rate || {};
    const hatch = cfg.hatch;
    return {
      id: i, hatch, exit: cfg.exit,
      cannon: cfg.cannon ? { x: cfg.cannon.x, y: cfg.cannon.y, dir: cfg.cannon.dir || hatch.dir || 1 } : null,
      count: cfg.count | 0, goal: cfg.goal || 0,
      needed: Math.ceil(((cfg.count | 0) * (cfg.goal || 0)) / 100),
      skills: Object.assign({}, cfg.skills),
      weapons, points: pts.start, regen: pts.regen, pointFrac: 0,
      rateMin: rate.min || C.RATE_MIN, rate: rate.start || 50,
      spawnCountdown: C.HATCH_DELAY, released: 0, saved: 0, dead: 0, deadBy: {},
      revealUntil: 0,
      stats: { skills: 0, weapons: 0, spent: 0, kills: 0 }
    };
  }

  class Simulation {
    /** @param {object} def description JSON du niveau */
    constructor(def) {
      this.def = def;
      this.terrain = NS.Loader.buildTerrain(def);
      this.rng = new NS.RNG(def.seed || 1);
      this.tick = 0;
      this.bidules = [];
      this.obstacles = [];          // bloqueurs et bâtisseurs, recalculés à chaque pas
      this.entities = [];           // drones, obus, boucliers, mines, chars...
      this.traps = (def.traps || []).map((t) => ({ x: t.x, y: t.y, alive: true }));
      this.fog = !!def.fog;
      this.nextId = 1;
      this.nextEid = 1;
      this.players = NS.Loader.playersOf(def).map(makePlayer);
      this.mode = this.players.length > 1 ? 'vs' : 'solo';
      this.timeLimitTicks = Math.round((def.timeLimit || 300) * C.TICK_RATE);
      this.status = 'running';      // running | won | lost | draw (du point de vue du joueur 0)
      this.endTimer = 0;
      this.events = [];             // consommés par le rendu/l'audio
      this.queue = [];              // commandes en attente
      this.log = [];                // journal des commandes appliquées
      this.denied = '';             // dernier motif de refus d'une arme (pour l'interface)
    }

    /* --------- Accesseurs de compatibilité : le joueur 0 est « le joueur » --------- */
    get count() { return this.players[0].count; }
    get saved() { return this.players[0].saved; }
    get dead() { return this.players[0].dead; }
    get released() { return this.players[0].released; }
    get needed() { return this.players[0].needed; }
    get skills() { return this.players[0].skills; }
    get rateMin() { return this.players[0].rateMin; }
    get rate() { return this.players[0].rate; }
    set rate(v) { this.players[0].rate = v; }

    /* ------------------------------ Événements ------------------------------ */

    emit(type, x, y, extra) { this.events.push({ type, x, y, extra }); }

    /* ------------------------------ Commandes ------------------------------- */

    /**
     * Enregistre une commande pour le pas courant et l'applique aussitôt (la
     * simulation est entre deux pas, c'est équivalent à l'appliquer au début du
     * prochain). En réseau, `cmd.tick` serait fixé par le serveur.
     * Champ `player` : 0 par défaut, 1 pour l'IA.
     */
    issue(cmd) {
      cmd.tick = this.tick;
      if (cmd.player === undefined) cmd.player = 0;
      this.queue.push(cmd);
      return this.flush();
    }

    /** Applique les commandes dont l'échéance est atteinte ; vrai si l'une a réussi. */
    flush() {
      if (!this.queue.length) return false;
      const due = this.queue.filter((c) => c.tick <= this.tick);
      this.queue = this.queue.filter((c) => c.tick > this.tick);
      let any = false;
      for (const cmd of due) if (this.apply(cmd)) { this.log.push(cmd); any = true; }
      return any;
    }

    apply(cmd) {
      if (this.status !== 'running') return false;
      const p = this.players[cmd.player | 0];
      if (!p) return false;
      switch (cmd.type) {
        case 'assign': {
          const b = this.bidules.find((x) => x.id === cmd.id);
          if (!b || b.owner !== p.id || !this.canAssign(b, cmd.skill)) return false;
          NS.Skills.byId[cmd.skill].assign(b, this);
          p.skills[cmd.skill]--;
          p.stats.skills++;
          this.emit('assign', b.x, b.y, cmd.skill);
          return true;
        }
        case 'rate': {
          const v = Math.max(p.rateMin, Math.min(C.RATE_MAX, cmd.value | 0));
          if (v === p.rate) return false;
          p.rate = v;
          return true;
        }
        case 'weapon': return this.fireWeapon(p, cmd);
        case 'steer': {
          const e = this.entities.find((x) => x.kind === 'drone' && x.owner === p.id);
          if (!e) return false;
          e.tx = Math.max(0, Math.min(this.terrain.w - 1, cmd.x));
          e.ty = Math.max(0, Math.min(this.terrain.h - 1, cmd.y));
          return true;
        }
        case 'detonate': {
          let n = 0;
          for (const e of this.entities) {
            if (e.owner !== p.id) continue;
            if (e.kind === 'mine') { this.blast(e.x, e.y - 2, 26, { owner: p.id, cause: 'mine' }); e.dead = true; n++; }
            else if (e.kind === 'drone') { e.boom = true; n++; }
          }
          return n > 0;
        }
      }
      return false;
    }

    /** La compétence est-elle disponible et applicable à ce Bidule ? */
    canAssign(b, skillId) {
      const def = NS.Skills.byId[skillId];
      if (!def || this.status !== 'running') return false;
      if ((this.players[b.owner].skills[skillId] | 0) <= 0) return false;
      if (b.state === 'dead' || b.state === 'saved' || b.state === 'rider') return false;
      return def.canAssign(b, this);
    }

    /** Motif pour lequel l'arme ne peut pas partir, ou null si elle le peut. */
    weaponBlock(p, id, cmd) {
      const w = NS.Weapons.byId[id], slot = p.weapons[id];
      if (!w || !slot) return 'Arme indisponible';
      if (slot.stock <= 0) return 'Stock épuisé';
      if (slot.cd > 0) return 'En recharge';
      if (p.points < w.cost) return 'Points insuffisants';
      return w.validate ? w.validate(this, p, cmd || {}) : null;
    }

    fireWeapon(p, cmd) {
      const why = this.weaponBlock(p, cmd.weapon, cmd);
      this.denied = why || '';
      if (why) return false;
      const w = NS.Weapons.byId[cmd.weapon], slot = p.weapons[cmd.weapon];
      p.points -= w.cost; p.stats.spent += w.cost; p.stats.weapons++;
      slot.stock--; slot.cd = w.cooldown;
      w.fire(this, p, cmd);
      this.emit('weapon', 0, 0, cmd.weapon);
      return true;
    }

    /* --------------------------- Aides physiques ---------------------------- */

    /**
     * Un obstacle du MÊME camp arrête-t-il `b` qui s'apprête à aller en `nx` ?
     * Renvoie l'obstacle ou null.
     *  - Bloqueur : zone de ±6 pixels, seulement si le Bidule s'en rapproche
     *    (il fait alors demi-tour).
     *  - Bâtisseur, foreur ou mineur au travail : ceux qui marchent dans le même
     *    sens, à sa hauteur ou derrière lui (même en grappe superposée), s'arrêtent
     *    et attendent (état 'wait') au lieu de s'engager sur un escalier inachevé
     *    ou de buter contre le mur qu'il perce, puis de faire demi-tour vers un gouffre.
     */
    obstacleAt(b, nx) {
      const obs = this.obstacles;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (o === b || o.owner !== b.owner || Math.abs(o.y - b.y) > 8) continue;
        if (o.state === 'build' || o.state === 'bash' || o.state === 'mine') {
          if (b.dir !== o.dir) continue;
          const rel = (nx - o.x) * o.dir;
          if (rel <= 1 && rel >= -6) return o;
          continue;
        }
        const now = Math.abs(o.x - b.x), next = Math.abs(o.x - nx);
        if (next <= 6 && next < now) return o;
      }
      return null;
    }

    inExit(b) {
      const e = this.players[b.owner].exit;
      return Math.abs(b.x - e.x) <= 5 && b.y >= e.y - 8 && b.y <= e.y + 3;
    }

    /** Le Bidule est-il dans un dôme de bouclier (de n'importe quel camp) ? */
    shielded(b) {
      for (const e of this.entities) {
        if (e.kind !== 'shield') continue;
        const dx = b.x - e.x, dy = b.y - 5 - e.y;
        if (dx * dx + dy * dy <= e.r * e.r) return true;
      }
      return false;
    }

    /**
     * Explosion : creuse un cratère, tue les Bidules non protégés dans le
     * rayon (tous camps confondus) et désamorce les pièges touchés.
     */
    blast(x, y, r, opts) {
      opts = opts || {};
      if (opts.carve !== false) this.terrain.carveCircle(x, y, r, this.rng, !!opts.rock);
      for (const b of this.bidules) {
        if (b.state === 'dead' || b.state === 'saved' || b.state === 'rider') continue;
        const dx = b.x - x, dy = b.y - 4 - y, rr = r + 2;
        if (dx * dx + dy * dy <= rr * rr && !this.shielded(b)) NS.Physics.die(b, this, opts.cause || 'blast', opts.owner);
      }
      this.defuseTraps(x - r, y - r, x + r, y + r);
      this.emit('explode', x, y, r);
    }

    defuseTraps(x0, y0, x1, y1) {
      for (const t of this.traps) {
        if (t.alive && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) { t.alive = false; this.emit('trapoff', t.x, t.y); }
      }
    }

    /**
     * Brouillard de guerre : le point (x, y) est-il visible pour le joueur `pi` ?
     * Sans `fog` dans le niveau, tout est visible. Le drone de reconnaissance
     * révèle tout pendant 20 s. Sinon, rayon de vision autour des Bidules, de la
     * trappe, de la sortie et des drones du joueur.
     */
    canSee(pi, x, y) {
      if (!this.fog) return true;
      const p = this.players[pi];
      if (this.tick < p.revealUntil) return true;
      const r2 = VISION * VISION;
      const near = (ax, ay) => (ax - x) * (ax - x) + (ay - y) * (ay - y) <= r2;
      if (near(p.hatch.x, p.hatch.y) || near(p.exit.x, p.exit.y)) return true;
      for (const b of this.bidules) if (b.owner === pi && near(b.x, b.y)) return true;
      for (const e of this.entities) if (e.owner === pi && (e.kind === 'drone' || e.kind === 'tank') && near(e.x, e.y)) return true;
      return false;
    }

    /* ------------------------------- Boucle --------------------------------- */

    /** Avance la simulation d'UN pas. */
    step() {
      if (this.status !== 'running') return;
      this.flush();
      for (const p of this.players) { this.spawn(p); this.economy(p); }

      this.obstacles.length = 0;
      for (const b of this.bidules) if (b.state === 'block' || b.state === 'build' || b.state === 'bash' || b.state === 'mine') this.obstacles.push(b);

      // Entités avant Bidules (une copie de longueur : celles créées pendant le pas jouent au suivant).
      for (let i = 0, n = this.entities.length; i < n; i++) {
        const e = this.entities[i], w = NS.Weapons.byKind[e.kind];
        if (w && w.update && !e.dead) w.update(e, this);
      }
      this.entities = this.entities.filter((e) => !e.dead);

      for (let i = 0, n = this.bidules.length; i < n; i++) NS.Physics.update(this.bidules[i], this);
      this.updateTraps();
      this.bidules = this.bidules.filter((b) => b.state !== 'dead' && b.state !== 'saved');

      this.tick++;
      this.checkEnd();
    }

    spawn(p) {
      if (p.released >= p.count) return;
      if (this.tick === C.HATCH_DELAY - 30) this.emit('hatch', p.hatch.x, p.hatch.y, p.id);
      if (--p.spawnCountdown > 0) return;
      const h = p.hatch;
      const b = new NS.Bidule(this.nextId++, h.x + this.rng.int(-2, 2), h.y, h.dir || 1, p.id);
      this.bidules.push(b);
      p.released++;
      p.spawnCountdown = NS.rateToInterval(p.rate);
      this.emit('spawn', b.x, b.y, p.id);
    }

    /** Points (régénération) et recharges des armes. */
    economy(p) {
      for (const id in p.weapons) if (p.weapons[id].cd > 0) p.weapons[id].cd--;
      if (++p.pointFrac >= C.TICK_RATE) {
        p.pointFrac = 0;
        p.points = Math.min(MAX_POINTS, p.points + p.regen);
      }
    }

    /** Pièges cachés : une mine sous les pieds d'un Bidule non protégé explose. */
    updateTraps() {
      for (const t of this.traps) {
        if (!t.alive) continue;
        for (const b of this.bidules) {
          if (b.state === 'dead' || b.state === 'saved' || b.state === 'rider') continue;
          if (Math.abs(b.x - t.x) <= 4 && b.y >= t.y - 10 && b.y <= t.y + 2 && !this.shielded(b)) {
            // Un piège ne tue que celui qui le déclenche et ne creuse rien : il ne coupe jamais la route.
            t.alive = false;
            NS.Physics.die(b, this, 'trap', -1);
            this.emit('explode', t.x, t.y - 2, 8);
            break;
          }
        }
      }
    }

    /** Armée `i` entièrement résolue : tous sortis et plus aucun en jeu. */
    resolved(p) {
      return p.released >= p.count && !this.bidules.some((b) => b.owner === p.id);
    }

    checkEnd() {
      const timeUp = this.tick >= this.timeLimitTicks;
      if (this.mode === 'solo') {
        const p = this.players[0];
        const done = this.resolved(p);
        if (!done && !timeUp) { this.endTimer = 0; return; }
        if (done && ++this.endTimer < C.END_GRACE_TICKS) return;
        this.status = p.saved >= p.needed ? 'won' : 'lost';
      } else {
        const [a, b] = this.players;
        const potential = (p) => p.saved + (p.count - p.released) + this.bidules.filter((x) => x.owner === p.id).length;
        const decided = a.saved > potential(b) || b.saved > potential(a);
        const done = this.resolved(a) && this.resolved(b);
        if (!done && !decided && !timeUp) { this.endTimer = 0; return; }
        if ((done || decided) && !timeUp && ++this.endTimer < C.END_GRACE_TICKS) return;
        this.status = a.saved > b.saved ? 'won' : a.saved < b.saved ? 'lost' : (a.dead < b.dead ? 'won' : a.dead > b.dead ? 'lost' : 'draw');
      }
      this.emit('end', 0, 0, this.status);
    }

    /** Secondes restantes (pour l'affichage). */
    timeLeft() { return Math.max(0, Math.ceil((this.timeLimitTicks - this.tick) / C.TICK_RATE)); }

    /* ------------------------ Instantanés et empreinte ---------------------- */

    snapshot() {
      return {
        tick: this.tick, rng: this.rng.getState(), nextId: this.nextId, nextEid: this.nextEid,
        players: JSON.parse(JSON.stringify(this.players)),
        entities: JSON.parse(JSON.stringify(this.entities)),
        traps: JSON.parse(JSON.stringify(this.traps)),
        status: this.status, endTimer: this.endTimer,
        bidules: this.bidules.map((b) => b.clone()),
        terrain: this.terrain.snapshot(), logLen: this.log.length
      };
    }

    restore(s) {
      this.tick = s.tick; this.rng.setState(s.rng); this.nextId = s.nextId; this.nextEid = s.nextEid;
      this.players = JSON.parse(JSON.stringify(s.players));
      this.entities = JSON.parse(JSON.stringify(s.entities));
      this.traps = JSON.parse(JSON.stringify(s.traps));
      this.status = s.status; this.endTimer = s.endTimer;
      this.bidules = s.bidules.map((b) => b.clone());
      this.terrain.restore(s.terrain);
      this.log.length = s.logLen;
      this.queue.length = 0;
      this.events.length = 0;
    }

    /** Empreinte de tout l'état : deux simulations identiques ont la même. */
    hash() {
      let h = this.terrain.hash();
      const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0; };
      mix(this.tick); mix(this.rng.getState());
      for (const p of this.players) {
        mix(p.released); mix(p.saved); mix(p.dead); mix(p.rate); mix(p.points);
        for (const id in p.weapons) { mix(p.weapons[id].stock); mix(p.weapons[id].cd); }
      }
      for (const b of this.bidules) {
        mix(b.id); mix(b.owner); mix(b.x); mix(b.y); mix(b.dir); mix(b.t); mix(b.fallDist);
        mix(b.bomb); mix(b.bricks); mix(b.floater ? 1 : 0); mix(b.climber ? 1 : 0);
        for (let i = 0; i < b.state.length; i++) mix(b.state.charCodeAt(i));
      }
      for (const e of this.entities) { mix(e.id); mix(Math.round(e.x * 16)); mix(Math.round((e.y || 0) * 16)); }
      for (const t of this.traps) mix(t.alive ? 1 : 0);
      return h >>> 0;
    }

    /**
     * Copie légère pour les « simulations d'essai » de l'IA : même terrain
     * (copié), mais aucun Bidule, aucune entité, stocks illimités. Elle
     * partage les règles de la vraie simulation, donc ses prévisions sont exactes.
     */
    static sandbox(src) {
      const s = Object.create(Simulation.prototype);
      s.def = src.def;
      s.terrain = new NS.Terrain(src.terrain.w, src.terrain.h);
      s.terrain.data.set(src.terrain.data);
      s.rng = new NS.RNG(1);
      s.tick = 0; s.bidules = []; s.obstacles = []; s.entities = []; s.traps = []; s.fog = false;
      s.nextId = 1; s.nextEid = 1; s.mode = 'solo'; s.status = 'running'; s.events = []; s.queue = []; s.log = [];
      s.players = src.players.map((p) => ({
        id: p.id, hatch: p.hatch, exit: p.exit, cannon: p.cannon, count: 0, goal: 0, needed: 0,
        skills: { blocker: 99, builder: 99, digger: 99, miner: 99, basher: 99, floater: 99, climber: 99, bomber: 99 },
        weapons: {}, points: 0, regen: 0, pointFrac: 0, rateMin: 1, rate: 50, spawnCountdown: 0,
        released: 0, saved: 0, dead: 0, deadBy: {}, revealUntil: 0, stats: { skills: 0, weapons: 0, spent: 0, kills: 0 }
      }));
      return s;
    }
  }

  NS.Simulation = Simulation;
})(typeof window !== 'undefined' ? window : globalThis);
