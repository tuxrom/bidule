/**
 * ai.js
 * Adversaire contrôlé par l'ordinateur. L'IA est un simple CLIENT de la
 * simulation : elle lit l'état public, puis émet des commandes avec
 * `sim.issue({player: i, ...})`, exactement comme l'interface du joueur.
 * Elle ne touche jamais directement un Bidule, un stock ou un terrain, et
 * dispose des mêmes ressources que l'humain (stocks, points, recharges).
 *
 * Ce qu'elle voit :
 *  - tout le terrain (la carte est symétrique et connue des deux camps) ;
 *  - ses propres Bidules ;
 *  - les Bidules adverses seulement s'ils sont visibles (brouillard de guerre,
 *    levé par son drone de reconnaissance).
 *
 * Trois profils (PROFILES) :
 *  - facile  : réaction lente (une décision toutes les 8 pas pour une tolérance de 7
 *    pixels), aucune planification : elle regarde 20 px devant chaque Bidule et
 *    réagit à un mur ou à un gouffre ; 25 % d'erreurs ; un seul type d'arme
 *    (le canon), visé approximativement ;
 *  - moyen   : plan A* recalculé toutes les 12 s, bonne précision, canon,
 *    drone kamikaze, mine et bouclier employés à bon escient ;
 *  - difficile : plan A* toutes les 7 s, reconnaissance puis frappes combinées
 *    (drone, satellite, canon avec tir anticipé), mines posées devant l'adversaire,
 *    bouclier contre les obus, rayons et drones, et lecture des ordres adverses
 *    pour viser les ouvrages que le joueur construit.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const C = NS.C;

  const PROFILES = {
    easy: {
      think: 8, lag: 7, err: 0.25, planner: false, weaponEvery: 150, anticipate: false,
      weapons: ['cannon'], aimTolerance: 70, reserve: 0
    },
    medium: {
      think: 4, lag: 3, err: 0.04, planner: true, maxActions: 2, replan: 360, weaponEvery: 60, anticipate: false,
      weapons: ['cannon', 'kdrone', 'mine', 'shield'], aimTolerance: 34, reserve: 10
    },
    hard: {
      think: 2, lag: 1, err: 0, planner: true, maxActions: 2, replan: 200, weaponEvery: 30, anticipate: true,
      weapons: ['recon', 'kdrone', 'satellite', 'cannon', 'shield', 'mine', 'jammer'], aimTolerance: 22, reserve: 15
    }
  };

  const WORK = { builder: 1, basher: 1, miner: 1, digger: 1 };

  class AIController {
    /**
     * @param {Simulation} sim
     * @param {number} pi        joueur contrôlé
     * @param {'easy'|'medium'|'hard'} level
     * @param {number} seed      graine propre à l'IA (ses hésitations sont reproductibles)
     */
    constructor(sim, pi, level, seed) {
      this.sim = sim;
      this.pi = pi;
      this.level = level;
      this.prof = PROFILES[level];
      this.rng = new NS.RNG(seed || 1234);
      this.plan = null;
      this.nextThink = 0;
      this.nextReplan = 0;
      this.nextWeapon = 300;           // pas d'arme dans les 10 premières secondes
      this.issued = [];                // {skill, x, tick} : évite de donner deux fois le même ordre
      this.focus = null;               // Bidule adverse qui construit : cible prioritaire
      this.logIdx = 0;
      this.planMs = 0;                 // temps cumulé passé à planifier (statistiques)
      const p = sim.players[pi], o = sim.players[1 - pi];
      this.dir = Math.sign(p.exit.x - p.hatch.x) || 1;
      this.enemyDir = -this.dir;
      this.enemyExit = o ? o.exit : null;
    }

    get player() { return this.sim.players[this.pi]; }
    /** Émet une commande : le SEUL canal par lequel l'IA agit. */
    cmd(c) { c.player = this.pi; return this.sim.issue(c); }
    own() { return this.sim.bidules.filter((b) => b.owner === this.pi); }
    progress(b) { return (b.x - this.player.hatch.x) * this.dir; }

    /** Bidules adverses que l'IA a le droit de voir. */
    visibleEnemies() {
      return this.sim.bidules.filter((b) => b.owner !== this.pi && b.state !== 'rider' && this.sim.canSee(this.pi, b.x, b.y));
    }

    /** Appelé à chaque pas, avant sim.step(). */
    update() {
      const sim = this.sim;
      if (sim.status !== 'running' || sim.tick < this.nextThink) return;
      this.nextThink = sim.tick + this.prof.think;
      this.watchEnemy();
      if (this.prof.planner) { this.safety(); this.planned(); } else this.reactive();
      this.pilot();
      this.mines();
      if (sim.tick >= this.nextWeapon) { this.nextWeapon = sim.tick + this.prof.weaponEvery; this.weapons(); }
    }

    /* ----------------------------- Compétences ----------------------------- */

    issuedRecently(skill, x) {
      const t = this.sim.tick;
      this.issued = this.issued.filter((e) => t - e.tick < 500);
      return this.issued.some((e) => e.skill === skill && Math.abs(e.x - x) <= 24);
    }

    assign(b, skill) {
      if (!this.sim.canAssign(b, skill)) return false;
      if (this.rng.next() < this.prof.err) {                       // erreur : ordre oublié (3 fois sur 4) ou outil gaspillé
        if (this.rng.next() < 0.75) return false;
        const wrong = ['floater', 'climber', 'digger'].filter((s) => (this.player.skills[s] | 0) > 0);
        if (wrong.length) skill = wrong[this.rng.int(0, wrong.length - 1)];
      }
      this.issued.push({ skill, x: b.x, tick: this.sim.tick });
      return this.cmd({ type: 'assign', id: b.id, skill });
    }

    /** Facile : aucun plan. Un regard de 20 px devant chaque Bidule qui marche. */
    reactive() {
      const t = this.sim.terrain, P = NS.Pathfinder;
      t.setViewer(this.pi);
      try { this.reactiveScan(t, P); } finally { t.setViewer(2); }
    }

    reactiveScan(t, P) {
      for (const b of this.own()) {
        if (b.state !== 'walk') continue;
        // Regard sur 40 px : premier obstacle, sa distance et sa matière.
        let x = b.x, y = b.y, kind = null, dist = 0, rock = false;
        for (let i = 0; i < 40 && !kind; i++) {
          const s = P.stepWalk(t, x, y, b.dir);
          if (s.kind === 'wall') { kind = 'wall'; dist = i; rock = t.get(x + b.dir, y - 3) === NS.M.ROCK; }
          else if (s.kind === 'fall') {
            const l = P.fallLand(t, s.x, s.y);
            if (!l.ok) { kind = 'gap'; dist = i; } else { x = s.x; y = l.y; }
          } else { x = s.x; y = s.y; }
        }
        if (!kind) continue;
        // Règles simples : un gouffre se franchit au bâtisseur depuis moins de 10 px (au-delà, l'escalier n'atteindrait pas l'autre bord) ; un mur de sable se fore
        // de près ; une roche indestructible exige un escalier commencé de plus loin (28 à 38 px).
        let skill = null;
        if (kind === 'gap' && dist >= 1 && dist <= 9) skill = 'builder';
        else if (kind === 'wall' && !rock && dist <= 18) skill = 'basher';
        else if (kind === 'wall' && rock && dist >= 28 && dist <= 38) skill = 'builder';
        if (!skill || (this.player.skills[skill] | 0) <= 0 || this.issuedRecently(skill, b.x)) continue;
        if (this.assign(b, skill)) return;
      }
    }

    /**
     * Réflexes (moyen et difficile). Un trou ou un mur peut surgir à tout moment (frappe adverse) :
     *  - si l'obstacle apparaît dans les 70 px devant le Bidule de tête, on replanifie sans attendre ;
     *  - si un gouffre mortel est à moins de 14 px et qu'aucun outil n'est prévu là, un Bidule se sacrifie
     *    en bloqueur pour retenir le flot (le plan prendra le relais derrière lui).
     */
    safety() {
      const sim = this.sim, t = sim.terrain, P = NS.Pathfinder;
      let lead = null;
      for (const b of this.own()) if (b.state === 'walk' && (!lead || this.progress(b) > this.progress(lead))) lead = b;
      if (!lead) return;
      t.setViewer(this.pi);
      let ahead, danger;
      try { ahead = P.blockedAhead(t, lead.x, lead.y, lead.dir, 70); danger = P.blockedAhead(t, lead.x, lead.y, lead.dir, 14) === 'gap'; } finally { t.setViewer(2); }
      const planned = this.plan && this.plan.actions.some((a) => (a.x - lead.x) * lead.dir >= -2 && (a.x - lead.x) * lead.dir <= 70);
      if (ahead && !planned && sim.tick - (this.lastPlanTick || 0) > 40) { this.replan(); return; }
      const worker = this.own().some((b) => b.state === 'build' || b.state === 'mine' || b.state === 'bash');
      const toolSoon = this.plan && this.plan.actions.some((a) => (a.x - lead.x) * lead.dir >= -2 && (a.x - lead.x) * lead.dir <= 20);
      if (danger && !worker && !toolSoon && !this.issuedRecently('blocker', lead.x) && (this.player.skills.blocker | 0) > 0) {
        this.issued.push({ skill: 'blocker', x: lead.x, tick: sim.tick });
        this.cmd({ type: 'assign', id: lead.id, skill: 'blocker' });
      }
    }

    /** Moyen et difficile : plan A* partiel, exécuté dès que les Bidules arrivent au bon endroit. */
    planned() {
      const sim = this.sim;
      // Pas de nouveau plan pendant un chantier : le terrain est à moitié transformé et le plan
      // partirait d'un suiveur arrêté derrière l'ouvrier. On replanifie 20 pas après sa fin.
      const busy = this.own().some((b) => b.state === 'build' || b.state === 'bash' || b.state === 'mine');
      if (busy) this.nextReplan = Math.max(this.nextReplan, sim.tick + 20);
      const spent = this.plan && this.plan.actions.length > 0 && this.plan.actions.every((a) => this.issuedRecently(a.skill, a.x));
      if (!this.plan || (!busy && (sim.tick >= this.nextReplan || spent))) this.replan();
      for (const a of this.plan.actions) {
        if (this.issuedRecently(a.skill, a.x) || (this.player.skills[a.skill] | 0) <= 0) continue;
        let lead = null;
        for (const b of this.own()) {
          if (b.state !== 'walk' || b.dir !== a.dir || Math.abs(b.y - a.y) > 2) continue;
          const past = (b.x - a.x) * a.dir;
          if (past < 0 || past > this.prof.lag) continue;
          if (!lead || this.progress(b) > this.progress(lead)) lead = b;
        }
        if (lead && this.assign(lead, a.skill)) return;
      }
    }

    replan() {
      const sim = this.sim, p = this.player;
      let start = null, best = -Infinity;
      for (const b of this.own()) {
        if ((b.state === 'walk' || b.state === 'wait') && this.progress(b) > best) { best = this.progress(b); start = { x: b.x, y: b.y, dir: this.dir }; }
      }
      if (!start) {                                                 // personne encore : sous la trappe
        let y = p.hatch.y;
        while (!sim.terrain.isSolid(p.hatch.x, y + 1) && y < sim.terrain.h - 2) y++;
        start = { x: p.hatch.x, y, dir: this.dir };
      }
      const t0 = Date.now();
      this.plan = NS.Pathfinder.plan(sim, this.pi, start, { maxActions: this.prof.maxActions, margin: this.prof.lag });
      this.planMs += Date.now() - t0;
      this.nextReplan = sim.tick + this.prof.replan;
      this.lastPlanTick = sim.tick;
    }

    /* ------------------------------- Armes ---------------------------------- */

    /** Lit les ordres adverses (publics, comme dans un jeu en réseau) : qui construit ? */
    watchEnemy() {
      const log = this.sim.log;
      for (; this.logIdx < log.length; this.logIdx++) {
        const c = log[this.logIdx];
        if (c.player !== this.pi && c.type === 'assign' && WORK[c.skill]) this.focus = { id: c.id, until: this.sim.tick + 360 };
      }
    }

    /** Vrai si l'arme est autorisée pour ce profil et utilisable maintenant. */
    ready(id, extra) {
      if (!this.prof.weapons.includes(id)) return false;
      const p = this.player, w = NS.Weapons.byId[id], slot = p.weapons[id];
      return !!(slot && slot.stock > 0 && slot.cd === 0 && p.points >= w.cost + this.prof.reserve + (extra || 0));
    }

    friendlyNear(x, y, r) {
      return this.own().some((b) => b.state !== 'rider' && (b.x - x) * (b.x - x) + (b.y - 4 - y) * (b.y - 4 - y) <= r * r);
    }

    /** Regroupe les adversaires visibles : liste triée du groupe le plus intéressant au moins intéressant. */
    clusters(enemies) {
      const out = [];
      for (const e of enemies) {
        const mates = enemies.filter((o) => Math.abs(o.x - e.x) <= 26 && Math.abs(o.y - e.y) <= 16);
        const cx = mates.reduce((s, m) => s + m.x, 0) / mates.length, cy = mates.reduce((s, m) => s + m.y, 0) / mates.length;
        const walking = mates.filter((m) => m.state === 'walk').length > mates.length / 2;
        const focus = this.focus && this.sim.tick < this.focus.until && mates.some((m) => m.id === this.focus.id);
        // Plus un groupe est avancé vers sa sortie, plus il est dangereux.
        const adv = Math.max(0, Math.min(1, ((cx - this.sim.players[1 - this.pi].hatch.x) * this.enemyDir) / Math.abs(this.player.hatch.x - this.enemyExit.x)));
        out.push({ x: Math.round(cx), y: Math.round(cy), n: mates.length, dir: mates[0].dir, walking, focus, score: mates.length * 10 + adv * 12 + (focus ? 25 : 0) });
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    }

    /** Visée du canon : voir Weapons.cannon.solve (même calcul que l'interface du joueur). */
    solveAim(tx, ty) { return NS.Weapons.byId.cannon.solve(this.sim, this.player, tx, ty); }

    weapons() {
      const sim = this.sim, p = this.player, pr = this.prof;
      const enemies = this.visibleEnemies();
      const groups = this.clusters(enemies);
      const top = groups[0];

      // Défense d'abord (difficile et moyen) : un dôme sur mon groupe menacé.
      if (this.ready('shield') && this.defend()) return;

      // Contre-mesure (difficile) : une mine adverse visible devant mon Bidule de tête est détruite à distance.
      if (pr.anticipate && this.clearMines()) return;

      // Reconnaissance : sans cible visible, on lève le brouillard.
      if (!enemies.length && this.ready('recon') && sim.tick > 360 && sim.tick >= p.revealUntil) {
        if (this.cmd({ type: 'weapon', weapon: 'recon' })) return;
      }
      if (!top) return;

      // Satellite : un trou sans fond est permanent et gêne TOUT le monde sur le chemin commun, y compris mes
      // propres Bidules qui sortent encore de la trappe. Un seul endroit est sans risque : derrière ma trappe,
      // juste avant la sortie adverse. Le rayon y claque la porte au nez de leurs derniers pas (une fois).
      if (this.ready('satellite', 5) && sim.tick > 600 && !this.slammed) {
        const x = this.enemyExit.x + this.dir * 12;
        if (Math.abs(x - this.enemyExit.x) < 40 && (x - p.hatch.x) * this.dir <= -6 && !this.friendlyNear(x, this.enemyExit.y, 14)) {
          this.slammed = true;
          if (this.cmd({ type: 'weapon', weapon: 'satellite', x })) return;
        }
      }
      // Brouilleur (difficile) : juste avant une frappe, pour que l'adversaire ne puisse pas lever de bouclier.
      const other = sim.players[1 - this.pi];
      if (this.ready('jammer', 25) && top.n >= 3 && other.jammedUntil <= sim.tick && (this.ready('cannon') || this.ready('kdrone'))) {
        if (this.cmd({ type: 'weapon', weapon: 'jammer' })) return;
      }
      // Drone kamikaze : surtout après une reconnaissance, il va chercher le groupe.
      if (this.ready('kdrone') && (top.n >= 2 || top.focus) && (pr.anticipate ? sim.tick < p.revealUntil || top.n >= 3 : top.n >= 3)) {
        if (this.cmd({ type: 'weapon', weapon: 'kdrone', x: top.x, y: top.y - 6 })) return;
      }
      // Canon.
      if (this.ready('cannon') && (top.n >= 2 || top.focus || this.level === 'easy')) {
        let tx = top.x, ty = top.y;
        let aim = this.solveAim(tx, ty);
        if (aim && pr.anticipate && top.walking) {                // tir anticipé : ils avancent pendant le vol
          tx = top.x + top.dir * Math.round(aim.t * 0.9);
          aim = this.solveAim(tx, ty);
        }
        if (aim && aim.d <= pr.aimTolerance && !this.friendlyNear(aim.x, aim.y, 40)) {
          if (this.level === 'easy') {                            // facile : tir approximatif
            aim.power = Math.max(0, Math.min(100, aim.power + this.rng.int(-18, 18)));
            aim.angle = Math.max(5, Math.min(85, aim.angle + this.rng.int(-6, 6)));
          }
          if (this.cmd({ type: 'weapon', weapon: 'cannon', angle: aim.angle, power: aim.power })) return;
        }
      }
      // Mine : posée devant le groupe adverse le plus avancé.
      if (this.ready('mine') && top.n >= 2 && sim.entities.filter((e) => e.kind === 'mine' && e.owner === this.pi).length < 2) {
        const x = top.x + top.dir * 45, y = top.y;
        if (!this.friendlyNear(x, y, 36)) this.cmd({ type: 'weapon', weapon: 'mine', x, y });
      }
    }

    /** Détruit une mine adverse visible qui barre ma route (canon, sinon drone). Vrai si une arme est partie. */
    clearMines() {
      const sim = this.sim, p = this.player;
      let lead = null;
      for (const b of this.own()) if (b.state !== 'rider' && (!lead || this.progress(b) > this.progress(lead))) lead = b;
      if (!lead) return false;
      for (const m of sim.entities) {
        if (m.kind !== 'mine' || m.owner === this.pi || !sim.canSee(this.pi, m.x, m.y)) continue;
        const ahead = (m.x - lead.x) * this.dir;
        if (ahead < -10 || ahead > 110 || this.friendlyNear(m.x, m.y, 34)) continue;
        if (this.ready('cannon')) {
          const aim = this.solveAim(m.x, m.y);
          if (aim && aim.d <= 24 && !this.friendlyNear(aim.x, aim.y, 36)) return !!this.cmd({ type: 'weapon', weapon: 'cannon', angle: aim.angle, power: aim.power });
        }
        if (this.ready('kdrone')) return !!this.cmd({ type: 'weapon', weapon: 'kdrone', x: m.x, y: m.y });
      }
      return false;
    }

    /** Menaces visibles : obus, rayon verrouillé, drone adverse. Un bouclier sur le groupe concerné. */
    defend() {
      const sim = this.sim;
      const mine = this.own();
      if (mine.length < 3) return false;
      const around = (x, y, r) => mine.filter((b) => (b.x - x) * (b.x - x) + (b.y - 4 - y) * (b.y - 4 - y) <= r * r);
      for (const e of sim.entities) {
        if (e.owner === this.pi || !sim.canSee(this.pi, e.x || 0, e.y || 0)) continue;
        let tx = null, ty = null, soon = false;
        if (e.kind === 'shell') {                                  // impact prévu en prolongeant la trajectoire
          const r = this.predictShell(e);
          if (r) { tx = r.x; ty = r.y; soon = r.t > 6; }
        } else if (e.kind === 'mine' && this.prof.anticipate) { tx = e.x; ty = e.y; soon = true; }   // mine visible près de mon groupe
        else if (e.kind === 'beam' && e.t < 40) { tx = e.x; ty = mine[0].y; soon = true; }
        else if (e.kind === 'drone') { tx = e.tx; ty = e.ty; soon = Math.abs(e.x - e.tx) + Math.abs(e.y - e.ty) < 120; }
        if (tx === null || !soon) continue;
        const g = around(tx, ty, e.kind === 'beam' ? 20 : e.kind === 'mine' ? 30 : 45);
        if (g.length >= 2 && !sim.shielded(g[0])) {
          const cx = Math.round(g.reduce((s, b) => s + b.x, 0) / g.length), cy = Math.round(g.reduce((s, b) => s + b.y - 5, 0) / g.length);
          if (this.cmd({ type: 'weapon', weapon: 'shield', x: cx, y: cy })) return true;
        }
      }
      return false;
    }

    /** Point d'impact d'un obus en vol (même intégrateur que le canon). */
    predictShell(e) {
      const t = this.sim.terrain;
      let x = e.x, y = e.y, vx = e.vx, vy = e.vy;
      for (let i = 0; i < 400; i++) {
        vy += 0.12;
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
        for (let k = 0; k < n; k++) {
          x += vx / n; y += vy / n;
          if (t.isSolid(Math.round(x), Math.round(y))) return { x: Math.round(x), y: Math.round(y), t: i };
        }
        if (y > t.h + 40) return null;
      }
      return null;
    }

    /** Pilote le drone kamikaze vers le groupe adverse le plus intéressant. */
    pilot() {
      const sim = this.sim;
      const d = sim.entities.find((e) => e.kind === 'drone' && e.owner === this.pi);
      if (!d) return;
      const groups = this.clusters(this.visibleEnemies());
      if (!groups.length) { if (d.ttl < 120) this.cmd({ type: 'detonate', what: 'drone' }); return; }
      const g = groups[0];
      const near = (d.x - g.x) * (d.x - g.x) + (d.y - g.y) * (d.y - g.y) < 14 * 14;
      if (near && this.friendlyNear(d.x, d.y, 26)) return;           // pas de tir ami
      const lead = this.prof.anticipate && g.walking ? g.dir * 8 : 0;
      this.cmd({ type: 'steer', x: g.x + lead, y: g.y - 4 });
    }

    /** Fait sauter les mines quand au moins deux adversaires les entourent et qu'aucun ami n'est dans la zone. */
    mines() {
      const sim = this.sim;
      const mine = sim.entities.filter((e) => e.kind === 'mine' && e.owner === this.pi);
      if (!mine.length) return;
      const enemies = this.visibleEnemies();
      for (const m of mine) {
        const near = enemies.filter((b) => Math.abs(b.x - m.x) <= 22 && Math.abs(b.y - m.y) <= 14).length;
        const friends = this.friendlyNear(m.x, m.y - 2, 30);
        if (near >= (this.level === 'hard' ? 2 : 3) && !friends) { this.cmd({ type: 'detonate', what: 'mine' }); return; }
      }
    }
  }

  NS.AI = { Controller: AIController, PROFILES };
})(typeof window !== 'undefined' ? window : globalThis);
