/**
 * simulation.js
 * Cœur du jeu : état du monde et avancement par pas FIXES (30 Hz).
 *
 * Règles de conception, pensées pour le multijoueur futur (verrouillage des
 * pas / lockstep) :
 *  - aucune dépendance au DOM, au temps réel ni à Math.random() ;
 *  - toute action du joueur est une COMMANDE sérialisable {tick, type, ...} ;
 *    état initial + graine + journal de commandes = partie reproductible ;
 *  - l'ordre de mise à jour des Bidules est l'ordre du tableau (stable) ;
 *  - la simulation ne dessine rien : elle publie des événements (sons,
 *    particules) que le rendu et l'audio consomment.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const C = NS.C;

  class Simulation {
    /** @param {object} def description JSON du niveau */
    constructor(def) {
      this.def = def;
      this.terrain = NS.Loader.buildTerrain(def);
      this.rng = new NS.RNG(def.seed || 1);
      this.tick = 0;
      this.bidules = [];
      this.obstacles = [];          // bloqueurs et bâtisseurs, recalculés à chaque pas
      this.nextId = 1;
      this.released = 0;
      this.saved = 0;
      this.dead = 0;
      this.count = def.count;
      this.needed = Math.ceil((def.count * (def.goal || 50)) / 100);
      this.timeLimitTicks = Math.round((def.timeLimit || 300) * C.TICK_RATE);
      this.skills = Object.assign({}, def.skills);   // stocks restants
      this.rateMin = (def.rate && def.rate.min) || C.RATE_MIN;
      this.rate = (def.rate && def.rate.start) || 50;
      this.spawnCountdown = C.HATCH_DELAY;
      this.status = 'running';      // running | won | lost
      this.endTimer = 0;
      this.events = [];             // consommés par le rendu/l'audio
      this.queue = [];              // commandes en attente
      this.log = [];                // journal des commandes appliquées
    }

    /* ------------------------------ Événements ------------------------------ */

    emit(type, x, y, extra) { this.events.push({ type, x, y, extra }); }

    /* ------------------------------ Commandes ------------------------------- */

    /**
     * Enregistre une commande pour le pas courant et l'applique immédiatement
     * (la simulation est entre deux pas, donc c'est équivalent à l'appliquer au
     * début du prochain). En réseau, `cmd.tick` serait fixé par le serveur.
     */
    issue(cmd) {
      cmd.tick = this.tick;
      this.queue.push(cmd);
      this.flush();
    }

    /** Applique les commandes dont l'échéance est atteinte. */
    flush() {
      if (!this.queue.length) return;
      const due = this.queue.filter((c) => c.tick <= this.tick);
      this.queue = this.queue.filter((c) => c.tick > this.tick);
      for (const cmd of due) if (this.apply(cmd)) this.log.push(cmd);
    }

    apply(cmd) {
      if (cmd.type === 'assign') {
        const b = this.bidules.find((x) => x.id === cmd.id);
        if (!b || !this.canAssign(b, cmd.skill)) return false;
        NS.Skills.byId[cmd.skill].assign(b, this);
        this.skills[cmd.skill]--;
        this.emit('assign', b.x, b.y, cmd.skill);
        return true;
      }
      if (cmd.type === 'rate') {
        const v = Math.max(this.rateMin, Math.min(C.RATE_MAX, cmd.value | 0));
        if (v === this.rate) return false;
        this.rate = v;
        return true;
      }
      return false;
    }

    /** La compétence est-elle disponible et applicable à ce Bidule ? */
    canAssign(b, skillId) {
      const def = NS.Skills.byId[skillId];
      if (!def || this.status !== 'running') return false;
      if ((this.skills[skillId] | 0) <= 0) return false;
      if (b.state === 'dead' || b.state === 'saved') return false;
      return def.canAssign(b, this);
    }

    /* --------------------------- Aides physiques ---------------------------- */

    /**
     * Un obstacle (bloqueur, bâtisseur au travail) renvoie-t-il `b` qui
     * s'apprête à aller en `nx` ? Zone de ±6 pixels, à peu près à la même hauteur,
     * et seulement si le Bidule s'en rapproche (un Bidule qui s'en éloigne passe).
     */
    obstacleBlocks(b, nx) {
      const obs = this.obstacles;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (o === b || Math.abs(o.y - b.y) > 8) continue;
        const now = Math.abs(o.x - b.x), next = Math.abs(o.x - nx);
        if (next <= 6 && next < now) return true;
      }
      return false;
    }

    inExit(b) {
      const e = this.def.exit;
      return Math.abs(b.x - e.x) <= 5 && b.y >= e.y - 8 && b.y <= e.y + 3;
    }

    /* ------------------------------- Boucle --------------------------------- */

    /** Avance la simulation d'UN pas. */
    step() {
      if (this.status !== 'running') return;
      this.flush();
      this.spawn();

      this.obstacles.length = 0;
      for (const b of this.bidules) if (b.state === 'block' || b.state === 'build') this.obstacles.push(b);

      // Copie de longueur : un Bidule créé pendant le pas ne joue qu'au suivant.
      for (let i = 0, n = this.bidules.length; i < n; i++) NS.Physics.update(this.bidules[i], this);
      this.bidules = this.bidules.filter((b) => b.state !== 'dead' && b.state !== 'saved');

      this.tick++;
      this.checkEnd();
    }

    spawn() {
      if (this.released >= this.count) return;
      if (this.tick === C.HATCH_DELAY - 30) this.emit('hatch', this.def.hatch.x, this.def.hatch.y);
      if (--this.spawnCountdown > 0) return;
      const h = this.def.hatch;
      const b = new NS.Bidule(this.nextId++, h.x + this.rng.int(-2, 2), h.y, h.dir || 1);
      this.bidules.push(b);
      this.released++;
      this.spawnCountdown = NS.rateToInterval(this.rate);
      this.emit('spawn', b.x, b.y);
    }

    checkEnd() {
      const resolved = this.released >= this.count && this.bidules.length === 0;
      const timeUp = this.tick >= this.timeLimitTicks;
      if (!resolved && !timeUp) { this.endTimer = 0; return; }
      if (resolved && ++this.endTimer < C.END_GRACE_TICKS) return;
      this.status = this.saved >= this.needed ? 'won' : 'lost';
      this.emit('end', 0, 0, this.status);
    }

    /** Secondes restantes (pour l'affichage). */
    timeLeft() { return Math.max(0, Math.ceil((this.timeLimitTicks - this.tick) / C.TICK_RATE)); }

    /* ------------------------ Instantanés et empreinte ---------------------- */

    snapshot() {
      return {
        tick: this.tick, rng: this.rng.getState(), nextId: this.nextId,
        released: this.released, saved: this.saved, dead: this.dead,
        skills: Object.assign({}, this.skills), rate: this.rate,
        spawnCountdown: this.spawnCountdown, status: this.status, endTimer: this.endTimer,
        bidules: this.bidules.map((b) => b.clone()),
        terrain: this.terrain.snapshot(), logLen: this.log.length
      };
    }

    restore(s) {
      this.tick = s.tick; this.rng.setState(s.rng); this.nextId = s.nextId;
      this.released = s.released; this.saved = s.saved; this.dead = s.dead;
      this.skills = Object.assign({}, s.skills); this.rate = s.rate;
      this.spawnCountdown = s.spawnCountdown; this.status = s.status; this.endTimer = s.endTimer;
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
      mix(this.tick); mix(this.rng.getState()); mix(this.released); mix(this.saved); mix(this.dead); mix(this.rate);
      for (const b of this.bidules) {
        mix(b.id); mix(b.x); mix(b.y); mix(b.dir); mix(b.t); mix(b.fallDist);
        mix(b.bomb); mix(b.bricks); mix(b.floater ? 1 : 0);
        for (let i = 0; i < b.state.length; i++) mix(b.state.charCodeAt(i));
      }
      return h >>> 0;
    }
  }

  NS.Simulation = Simulation;
})(typeof window !== 'undefined' ? window : globalThis);
