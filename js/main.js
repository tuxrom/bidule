/**
 * main.js
 * Chef d'orchestre : crée les modules, pilote la boucle principale, la visée
 * des armes et les écrans (titre, campagne, contre l'ordinateur, pause,
 * résultats avec statistiques).
 *
 * Boucle : requestAnimationFrame mesure le temps réel écoulé, l'accumule, et
 * lance autant de pas de simulation FIXES (1/30 s) que nécessaire. Avant chaque
 * pas, l'IA (mode contre l'ordinateur) émet ses commandes par la même porte
 * que le joueur : sim.issue(). Le rendu a lieu une fois par image.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const $ = (id) => document.getElementById(id);
  const STEP = 1 / NS.C.TICK_RATE;
  const MAX_STEPS_PER_FRAME = 8;     // garde-fou : on lâche du retard plutôt que de geler l'écran
  const UNDO_LIMIT = 30;

  const DIFFICULTIES = {
    easy: { name: 'Facile', text: 'Réagit lentement, se trompe souvent, ne tire qu\'au canon, à peu près.' },
    medium: { name: 'Moyen', text: 'Planifie sa route, emploie canon, drone, mine et bouclier à bon escient.' },
    hard: { name: 'Difficile', text: 'Route optimale, reconnaissance puis frappes combinées, tirs anticipés, lit tes ordres.' }
  };
  const HINTS = {
    point: 'Touche la cible.', bidule: 'Touche un de tes Bidules.', line: 'Touche le départ du câble, puis son arrivée (plus bas).',
    'bidule-point': 'Touche un Bidule, puis le point d\'accroche.', aim: 'Touche la carte pour viser, règle angle et puissance, puis Tirer (Entrée).',
    pilot: 'Déplace le curseur pour piloter le drone. Touche ou « Détoner » pour le faire exploser.'
  };
  const CAUSES = [
    ['Chutes', ['splat']], ['Noyés', ['drown']], ['Brûlés', ['burn']], ['Pièges', ['trap']],
    ['Kamikazes', ['explode']], ['Armes adverses ou amies', ['blast', 'shell', 'drone', 'mine', 'beam', 'crush']], ['Hors de la carte', ['oob']]
  ];
  const fmtTime = (ticks) => { const s = Math.round(ticks / NS.C.TICK_RATE); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  class Game {
    constructor() {
      NS.Sprites.build();                       // doit précéder le HUD (icônes)
      this.canvas = $('game');
      this.cam = new NS.Camera();
      this.renderer = new NS.Renderer(this.canvas, this.cam);
      this.fx = new NS.Particles();
      this.audio = new NS.AudioEngine();
      this.hud = new NS.HUD();
      this.input = new NS.Input(this, this.canvas);
      NS.Campaign.Save.load();

      this.sim = null;
      this.me = 0;                   // camp du joueur local (0 sauf pour l'invité d'un duel en ligne)
      this.net = null;               // NetSession en ligne
      this.ai = null;
      this.kind = 'campaign';        // 'campaign' | 'vs'
      this.levelIndex = 0;
      this.vsDifficulty = 'medium';
      this.tab = 'skills';
      this.skill = null;
      this.weapon = null;
      this.tgt = null;               // première étape d'une visée en deux temps
      this.aim = { angle: 45, power: 60 };
      this.ptr = null;               // pointeur en coordonnées du monde
      this.lastSteer = 0;
      this.paused = false;
      this.overlayOpen = false;
      this.speed = 1;
      this.acc = 0;
      this.undoStack = [];
      this.hoverId = 0;
      this.hoverOk = false;
      this.resultTimer = 0;
      this.last = 0;
      this.time = 0;
      this.slowFrames = 0;

      this.bindUI();
      this.hud.setMuted(this.audio.muted);
      new ResizeObserver(() => this.onResize()).observe($('stage'));
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.sim && !this.overlayOpen) this.setPaused(true); });
      this.onResize();
      this.showTitle();
      requestAnimationFrame((t) => this.frame(t));
    }

    onResize() {
      this.renderer.resize();
      this.cam.clamp();
    }

    /* --------------------------------- Boutons --------------------------------- */

    bindUI() {
      $('skillbar').addEventListener('click', (e) => {
        const b = e.target.closest('.skill');
        if (!b) return;
        this.audio.unlock();
        this.selectSkillIndex(NS.Skills.list.findIndex((s) => s.id === b.dataset.skill));
      });
      $('armbar').addEventListener('click', (e) => {
        const b = e.target.closest('.arm');
        if (!b) return;
        this.audio.unlock();
        this.selectWeapon(b.dataset.weapon);
      });
      $('btn-tab').onclick = () => this.toggleTab();
      $('btn-pause').onclick = () => { this.audio.unlock(); this.togglePause(); };
      $('btn-x2').onclick = () => this.setSpeed(this.speed === 2 ? 1 : 2);
      $('btn-x4').onclick = () => this.setSpeed(this.speed === 4 ? 1 : 4);
      $('btn-undo').onclick = () => this.undo();
      $('btn-mute').onclick = () => { this.audio.unlock(); this.toggleMute(); };
      $('btn-menu').onclick = () => this.toggleMenu();
      $('btn-rate-dec').onclick = () => this.adjustRate(-5);
      $('btn-rate-inc').onclick = () => this.adjustRate(5);
      $('btn-boom').onclick = () => this.detonate();
      $('btn-chat').onclick = () => { const b = $('chatbar'); b.hidden = !b.hidden; if (!b.hidden) { b.innerHTML = this.emojiRow(); this.bindEmojiRow(); } };
      $('btn-fire').onclick = () => this.confirm();
      $('aim-angle').oninput = (e) => { this.aim.angle = Number(e.target.value); this.hud.showAim(true, this.aim.angle, this.aim.power); };
      $('aim-power').oninput = (e) => { this.aim.power = Number(e.target.value); this.hud.showAim(true, this.aim.angle, this.aim.power); };
      $('overlay').addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]');
        if (!a) return;
        this.audio.unlock();
        this.audio.sfx('select');
        this.action(a.dataset.action, a.dataset.arg);
      });
    }

    action(name, arg) {
      switch (name) {
        case 'campaign': this.showCampaign(arg === undefined ? this.worldView : Number(arg)); break;
        case 'world': this.showCampaign(Number(arg)); break;
        case 'versus': this.showVersus(); break;
        case 'online': this.showOnline(); break;
        case 'editor': this.showEditor(); break;
        case 'ed': this.edAction(arg); break;
        case 'net': this.netAction(arg); break;
        case 'install': this.installApp(); break;
        case 'fullscreen': this.toggleFullscreen(); break;
        case 'play': this.startCampaign(Number(arg)); break;
        case 'vs': this.startVS(arg); break;
        case 'next': this.startCampaign(this.levelIndex + 1); break;
        case 'retry': if (this.kind === 'vs') this.startVS(this.vsDifficulty); else if (this.kind === 'custom') this.startCustom(this.customDef); else this.startCampaign(this.levelIndex); break;
        case 'resume': this.closeOverlay(); break;
        case 'help': this.showHelp(); break;
        case 'title': this.showTitle(); break;
        case 'reset': if (confirm('Effacer toute la progression ?')) { NS.Campaign.Save.reset(); this.showCampaign(0); } break;
      }
    }

    /* ----------------------------------- Parties ----------------------------------- */

    /** Installe une simulation : caméra, interface, musique. */
    begin(def, kind, sim, me) {
      this.kind = kind;
      this.me = me | 0;
      this.sim = sim || new NS.Simulation(def);
      this.renderedSim = this.sim;
      this.renderer.resize();
      this.renderer.setLevel(this.sim);
      this.cam.setWorld(def.width, def.height);
      // Zoom de départ : environ 200 pixels de monde de large sur mobile, plus large sur grand écran.
      const z = Math.min(this.cam.vw / 260, this.cam.vh / 200);
      this.cam.zoom = Math.max(this.cam.minZoom(), Math.min(4, Math.max(2, z)));
      const vwW = this.cam.vw / this.cam.zoom, vwH = this.cam.vh / this.cam.zoom;
      const h = this.sim.players[this.me].hatch;
      this.cam.x = h.x - vwW * (h.dir < 0 ? 0.7 : 0.3);        // on voit devant soi, dans le sens de marche
      this.cam.y = h.y - vwH * 0.4;
      this.cam.clamp();
      this.cam.snap(this.renderer.dpr);
      this.fx.clear();
      this.undoStack = [];
      this.acc = 0;
      this.paused = false;
      this.speed = 1;
      this.resultTimer = 0;
      this.hoverId = 0;
      this.tgt = null;
      this.weapon = null;
      this.tab = 'skills';
      const first = NS.Skills.list.find((s) => (def.skills[s.id] | 0) > 0);
      this.skill = first ? first.id : null;
      document.body.dataset.theme = def.theme || 'desert';
      this.hud.setLevelName(def.name);
      this.hud.buildArmbar(this.sim, this.me);
      this.hud.setTab('skills');
      this.hud.showAim(false);
      this.hud.setPaused(false);
      this.hud.setSpeed(1);
      this.closeOverlay();
      this.audio.unlock();
      this.audio.startMusic(def.theme);
    }

    startCampaign(i) {
      const def = NS.Campaign.all()[i];
      if (!def || !NS.Campaign.Save.unlocked(i)) return this.showCampaign(this.worldView);
      this.levelIndex = i;
      this.ai = null;
      this.begin(def, 'campaign');
      this.worldView = Math.floor(i / NS.Campaign.PER_WORLD);
      const news = [];
      for (const [id, rank] of Object.entries(NS.Campaign.UNLOCK)) {
        if (rank === def.rank) news.push(id === 'climber' ? 'Compétence : Grimpeur' : 'Arme : ' + NS.Weapons.byId[id].label);
      }
      const msg = (news.length ? 'Nouveau ! ' + news.join(', ') + '. ' : '') + (def.hint || '');
      if (msg) this.hud.toast(msg, 7000);
    }

    startVS(difficulty) {
      this.vsDifficulty = difficulty;
      const seed = 100 + (Date.now() % 9000);
      const def = NS.Generator.buildVS({ id: 'vs-' + seed, name: 'Duel : ' + DIFFICULTIES[difficulty].name, theme: ['desert', 'ruins', 'arctic', 'orbital'][seed % 4], seed, segments: 3 + (seed % 2), traps: 1, count: 24 });
      this.begin(def, 'vs');
      this.ai = new NS.AI.Controller(this.sim, 1, difficulty, seed);
      this.hud.toast(def.hint, 6000);
    }

    restart() {
      if (!this.sim || this.kind === 'net' || this.kind === 'net-over') return;
      if (this.kind === 'vs') this.startVS(this.vsDifficulty); else if (this.kind === 'custom') this.startCustom(this.customDef); else this.startCampaign(this.levelIndex);
    }

    /* ---------------------------------- Sélections --------------------------------- */

    /** Chiffre du clavier : compétence ou arme selon l'onglet visible. */
    selectIndex(i) {
      if (this.tab === 'arms') {
        const ids = NS.Weapons.list.filter((w) => this.sim && this.sim.players[this.me].weapons[w.id]).map((w) => w.id);
        if (ids[i]) this.selectWeapon(ids[i]);
      } else this.selectSkillIndex(i);
    }

    selectSkillIndex(i) {
      const s = NS.Skills.list[i];
      if (!s || !this.sim || (this.sim.players[this.me].skills[s.id] | 0) <= 0 || this.barredSkill(s.id)) return;
      this.skill = s.id;
      this.tab = 'skills';
      this.hud.setTab('skills');
      this.audio.sfx('select');
    }

    toggleTab() {
      if (!this.sim || $('btn-tab').hidden) return;
      this.tab = this.tab === 'skills' ? 'arms' : 'skills';
      this.tgt = null;
      this.hud.setTab(this.tab);
      this.hud.showAim(this.tab === 'arms' && this.weapon === 'cannon', this.aim.angle, this.aim.power);
      this.audio.sfx('select');
    }

    selectWeapon(id) {
      const sim = this.sim, p = sim.players[this.me], w = NS.Weapons.byId[id], slot = p.weapons[id];
      this.audio.unlock();
      if (this.barredWeapon(id)) return this.refuse('Arme de ton partenaire');
      if (p.jammedUntil > sim.tick) return this.refuse('Brouillé par l\'adversaire');
      if (!slot || slot.stock <= 0) return this.refuse('Stock épuisé');
      if (slot.cd > 0) return this.refuse('En recharge (' + Math.ceil(slot.cd / NS.C.TICK_RATE) + ' s)');
      if (p.points < w.cost) return this.refuse('Points insuffisants (' + w.cost + ' requis)');
      this.weapon = id; this.tab = 'arms'; this.tgt = null;
      this.audio.sfx('select');
      this.hud.setTab('arms');
      this.hud.showAim(w.target === 'aim', this.aim.angle, this.aim.power);
      if (w.target === 'none') { this.fire({ weapon: id }); this.weapon = null; }
      else this.hud.toast(w.label + ' : ' + HINTS[w.target], 4200);
    }

    refuse(msg) { this.hud.toast(msg, 1800); this.audio.sfx('deny'); }

    /* ---------------------------------- Commandes ---------------------------------- */

    togglePause() { if (this.kind === 'net') return; this.setPaused(!this.paused); }
    setPaused(p) { if (!this.sim) return; this.paused = p; this.hud.setPaused(p); }
    setSpeed(s) { this.speed = s; this.hud.setSpeed(s); }
    cycleSpeed() { this.setSpeed(this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1); }
    toggleMute() { this.audio.setMuted(!this.audio.muted); this.hud.setMuted(this.audio.muted); }
    zoomStep(f) { this.cam.zoomAt(this.cam.vw / 2, this.cam.vh / 2, this.cam.zoom * f); this.cam.snap(this.renderer.dpr); }

    adjustRate(d) {
      if (!this.sim || this.overlayOpen) return;
      this.send({ type: 'rate', value: this.sim.players[this.me].rate + d });
    }

    /** Annule la dernière compétence ou arme (solo uniquement) : retour exact à l'état d'avant l'ordre. */
    undo() {
      if (!this.sim || this.overlayOpen || this.kind !== 'campaign' || !this.undoStack.length) return;
      this.sim.restore(this.undoStack.pop());
      this.renderer.invalidate(this.sim.terrain);
      this.fx.clear();
      this.acc = 0;
      this.hud.toast('Dernière action annulée', 1200);
    }

    pushUndo() {
      if (this.kind !== 'campaign') return;
      this.undoStack.push(this.sim.snapshot());
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }

    /**
     * Porte unique des ordres du joueur. Hors ligne : la simulation les applique aussitôt (`player` = mon camp).
     * En ligne : on les PROPOSE au serveur, qui les date, leur attribue un propriétaire et les diffuse ; ils
     * s'exécutent quelques pas plus tard, en même temps chez tout le monde.
     */
    send(cmd) {
      if (this.kind === 'net') { this.net.sendCommand(cmd); return true; }
      cmd.player = this.me;
      return this.sim.issue(cmd);
    }

    /** Tire une arme du joueur : en solo l'instantané d'annulation n'est gardé que si l'ordre réussit. */
    fire(cmd) {
      const sim = this.sim;
      if (!sim || this.overlayOpen || sim.status !== 'running') return false;
      cmd.type = 'weapon';
      if (this.kind === 'net') {                    // contrôle local d'abord : refus immédiat plutôt qu'un ordre perdu
        const why = sim.weaponBlock(sim.players[this.me], cmd.weapon, cmd);
        if (why || this.barredWeapon(cmd.weapon)) { this.refuse(why || 'Arme de ton partenaire'); return false; }
        this.net.sendCommand(cmd);
        this.audio.sfx('select');
        return true;
      }
      const snap = this.kind === 'campaign' ? sim.snapshot() : null;
      cmd.player = this.me;
      if (!sim.issue(cmd)) { this.refuse(sim.denied || 'Impossible'); return false; }
      if (snap) { this.undoStack.push(snap); if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift(); }
      this.flushEvents();
      return true;
    }

    /** Entrée / bouton Tirer : valide la visée du canon. */
    confirm() {
      if (this.tab === 'arms' && this.weapon === 'cannon') {
        if (this.fire({ weapon: 'cannon', angle: this.aim.angle, power: this.aim.power })) { this.hud.showAim(true, this.aim.angle, this.aim.power); }
      }
    }

    /** Fait sauter mines et drone du joueur. */
    detonate() {
      if (!this.sim || this.overlayOpen) return;
      if (this.send({ type: 'detonate' })) this.flushEvents();
    }

    /* ----------------------------------- Pointeur ----------------------------------- */

    /** Bidule du joueur le plus proche du point d'écran (toucher généreux). */
    pickOwn(sx, sy, touch, skill) {
      const w = this.cam.screenToWorld(sx, sy);
      const reach = (touch ? 24 : 10) / this.cam.zoom + 5;
      let best = null, bestScore = Infinity;
      for (const b of this.sim.bidules) {
        if (b.owner !== this.me || b.state === 'rider') continue;
        const d = Math.hypot(b.x - w.x, b.y - 5 - w.y);
        if (d > reach) continue;
        const score = d + (skill && !this.sim.canAssign(b, skill) ? 1000 : 0);
        if (score < bestScore) { bestScore = score; best = b; }
      }
      return best;
    }

    tap(sx, sy, touch) {
      if (!this.sim || this.overlayOpen || this.sim.status !== 'running') return;
      const w = this.cam.screenToWorld(sx, sy);
      this.ptr = w;
      if (this.tab === 'arms') { if (this.weapon) this.weaponTap(w, sx, sy, touch); return; }
      const b = this.pickOwn(sx, sy, touch, this.skill);
      if (!b || !this.skill) return;
      if (!this.sim.canAssign(b, this.skill) || this.barredSkill(this.skill)) { this.audio.sfx('deny'); return; }
      this.pushUndo();
      this.send({ type: 'assign', id: b.id, skill: this.skill });
      this.flushEvents();
    }

    /** Un toucher alors qu'une arme est choisie : selon son mode de visée. */
    weaponTap(w, sx, sy, touch) {
      const sim = this.sim, p = sim.players[this.me], def = NS.Weapons.byId[this.weapon];
      const x = Math.round(w.x), y = Math.round(w.y);
      switch (def.target) {
        case 'point': this.fire({ weapon: def.id, x, y }); break;
        case 'bidule': {
          const b = this.pickOwn(sx, sy, touch);
          if (b) this.fire({ weapon: def.id, id: b.id }); else this.audio.sfx('deny');
          break;
        }
        case 'line':
          if (!this.tgt) { this.tgt = { x1: x, y1: y }; this.hud.toast('Maintenant l\'arrivée du câble.', 2000); }
          else { this.fire({ weapon: def.id, x1: this.tgt.x1, y1: this.tgt.y1, x2: x, y2: y }); this.tgt = null; }
          break;
        case 'bidule-point':
          if (!this.tgt) {
            const b = this.pickOwn(sx, sy, touch);
            if (b) { this.tgt = { id: b.id }; this.hud.toast('Maintenant le point d\'accroche.', 2000); } else this.audio.sfx('deny');
          } else { this.fire({ weapon: def.id, id: this.tgt.id, x, y }); this.tgt = null; }
          break;
        case 'aim': {
          const r = def.solve(sim, p, x, y);
          if (r) { this.aim = { angle: r.angle, power: r.power }; this.hud.showAim(true, r.angle, r.power); }
          break;
        }
        case 'pilot': {
          const drone = sim.entities.find((e) => e.kind === 'drone' && e.owner === this.me);
          if (!drone) { if (this.fire({ weapon: def.id, x, y })) this.hud.toast(HINTS.pilot, 4000); }
          else this.detonate();
          break;
        }
      }
    }

    /** Position du pointeur : aperçus de visée et pilotage du drone. */
    pointerAt(sx, sy) {
      if (!this.sim) return;
      this.ptr = this.cam.screenToWorld(sx, sy);
      if (this.tab === 'arms' && this.weapon === 'kdrone' && !this.overlayOpen) {
        const now = performance.now();
        if (now - this.lastSteer > 90 && this.sim.entities.some((e) => e.kind === 'drone' && e.owner === this.me)) {
          this.lastSteer = now;
          this.send({ type: 'steer', x: Math.round(this.ptr.x), y: Math.round(this.ptr.y) });
        }
      }
    }

    hover(sx, sy) {
      if (!this.sim || sx < 0) { this.hoverId = 0; this.canvas.classList.remove('can-assign'); return; }
      const b = this.pickOwn(sx, sy, false, this.tab === 'skills' ? this.skill : null);
      this.hoverId = b ? b.id : 0;
      this.hoverOk = !!(b && (this.tab === 'arms' || (this.skill && this.sim.canAssign(b, this.skill))));
      this.canvas.classList.toggle('can-assign', this.hoverOk);
    }

    /** Aperçus dessinés dans le monde : trajectoire du canon, câble, portée du bouclier... */
    overlay(ctx, s) {
      const sim = this.sim, p = sim.players[this.me];
      if (this.tab !== 'arms' || !this.weapon || this.overlayOpen) return;
      const lw = 1 / s * this.renderer.dpr;
      ctx.lineWidth = lw;
      const def = NS.Weapons.byId[this.weapon];
      if (def.target === 'aim' && p.cannon) {
        ctx.fillStyle = 'rgba(255,230,140,0.9)';
        const end = def.trajectory(sim, p, this.aim.angle, this.aim.power, (x, y, i) => { if (i % 3 === 0) ctx.fillRect(Math.round(x), Math.round(y), 1, 1); });
        ctx.strokeStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(end.x, end.y, 30, 0, Math.PI * 2); ctx.stroke();
        return;
      }
      if (!this.ptr) return;
      const x = Math.round(this.ptr.x), y = Math.round(this.ptr.y);
      ctx.strokeStyle = 'rgba(255,240,150,0.9)';
      if (def.target === 'line' && this.tgt) { ctx.beginPath(); ctx.moveTo(this.tgt.x1, this.tgt.y1); ctx.lineTo(x, y); ctx.stroke(); }
      else if (def.target === 'bidule-point' && this.tgt) {
        const b = sim.bidules.find((q) => q.id === this.tgt.id);
        if (b) { ctx.beginPath(); ctx.moveTo(b.x, b.y - 8); ctx.lineTo(x, y); ctx.stroke(); }
      }
      if (this.weapon === 'shield') { ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.stroke(); }
      else if (this.weapon === 'satellite') { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sim.terrain.h); ctx.stroke(); }
      else if (this.weapon === 'mine' || this.weapon === 'tank') { ctx.strokeRect(x - 6.5, y - 8.5, 13, 10); }
      else if (this.weapon === 'kdrone') { ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.stroke(); }
    }

    /* ----------------------------------- Boucle ---------------------------------- */

    /** Distribue les événements de la simulation à l'audio et aux particules. */
    flushEvents() {
      const ev = this.sim.events;
      for (let i = 0; i < ev.length; i++) {
        this.fx.handle(ev[i]);
        // Les sons ennemis lointains restent audibles : l'information fait partie du jeu.
        this.audio.handle(ev[i]);
        if (ev[i].type === 'end') this.audio.sfx(ev[i].extra === 'won' ? 'win' : 'lose');
      }
      ev.length = 0;
    }

    /**
     * Qualité adaptative : si l'appareil tient moins de ~40 images/s pendant
     * deux secondes, on réduit la résolution interne du canvas (2 -> 1.5 -> 1).
     * Le gameplay n'est pas affecté : la simulation reste à pas fixes.
     */
    adaptQuality(dt) {
      if (this.overlayOpen || !this.sim) { this.slowFrames = 0; return; }
      this.slowFrames = dt > 1 / 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
      if (this.slowFrames > 90 && this.renderer.maxDpr > 1) {
        this.renderer.maxDpr = this.renderer.maxDpr > 1.5 ? 1.5 : 1;
        this.slowFrames = 0;
        this.onResize();
        this.cam.snap(this.renderer.dpr);
      }
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.time += dt;
      this.adaptQuality(dt);
      this.input.update(dt);
      if (this.kind === 'net' && this.net) this.netFrame(dt);       // le réseau fait avancer la simulation
      const sim = this.sim;
      if (!sim) return;

      const running = this.kind !== 'net' && !this.paused && !this.overlayOpen && sim.status === 'running';
      if (this.kind === 'net') { this.flushEvents(); this.fx.update(dt); } else if (running) {
        this.acc += dt * this.speed;
        let n = 0;
        while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME && sim.status === 'running') {
          if (this.ai) this.ai.update();           // l'IA joue avant chaque pas, par les mêmes commandes
          sim.step();
          this.flushEvents();
          this.acc -= STEP;
          n++;
        }
        if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
        this.fx.update(dt * this.speed);
      } else if (sim.status !== 'running') {
        this.flushEvents();
        this.fx.update(dt);
      }

      const me = sim.players[this.me];
      this.renderer.draw(sim, this.fx, {
        me: this.me, time: this.time, hoverId: this.hoverId, hoverOk: this.hoverOk,
        aimAngle: this.tab === 'arms' && this.weapon === 'cannon' ? this.aim.angle : null,
        overlay: (ctx, s) => this.overlay(ctx, s)
      });
      this.hud.update(sim, {
        me: this.me, tab: this.tab, skill: this.skill, weapon: this.weapon, canUndo: this.undoStack.length > 0, undoable: this.kind === 'campaign',
        mask: this.coopMask(),
        canBoom: sim.entities.some((e) => e.owner === this.me && (e.kind === 'mine' || e.kind === 'drone'))
      });
      // L'arme est déselectionnée quand elle ne peut plus partir (drone en vol : on garde le pilotage).
      if (this.weapon && this.weapon !== 'kdrone') {
        const slot = me.weapons[this.weapon], w = NS.Weapons.byId[this.weapon];
        if (slot && (slot.cd > 0 || slot.stock <= 0 || me.points < w.cost)) { this.weapon = null; this.tgt = null; this.hud.showAim(false); }
      }

      if (this.kind === 'net') this.netEndCheck(dt);
      else if (sim.status !== 'running' && !this.overlayOpen) {
        this.resultTimer += dt;
        if (this.resultTimer > 1.4) this.showResult();
      }
    }

    /* ----------------------------------- Écrans ----------------------------------- */

    openOverlay(html) {
      const o = $('overlay');
      o.innerHTML = html;
      o.hidden = false;
      this.overlayOpen = true;
      o.scrollTop = 0;
    }
    closeOverlay() { $('overlay').hidden = true; this.overlayOpen = false; }
    toggleMenu() {
      if (!this.sim) return;
      if (this.overlayOpen) this.closeOverlay(); else this.showPause();
    }

    showTitle() {
      document.body.dataset.theme = 'desert';
      const st = NS.Campaign.Save.totalStars();
      this.openOverlay(
        '<div class="card"><canvas class="logo" id="logo" width="8" height="10"></canvas>' +
        '<h1>Opération Mirage</h1><div class="sub">Les Bidules traversent quatre mondes</div>' +
        '<p>Guide ta troupe de petits soldats-robots jusqu\'à la sortie : ils marchent sans jamais s\'arrêter, à toi de leur confier les bonnes compétences. ' +
        'Débloque un arsenal moderne au fil de la campagne, ou affronte l\'ordinateur sur une carte symétrique.</p>' +
        '<div class="menu-grid">' +
        '<button class="btn primary" data-action="campaign">Campagne<small>40 niveaux, 4 univers, 3 étoiles par niveau (' + st + '/120)</small></button>' +
        '<button class="btn" data-action="versus">Contre l\'ordinateur<small>Deux armées, une carte miroir, un arsenal identique</small></button>' +
        '<button class="btn" data-action="online">En ligne<small>Duel à deux, ou coopération sur une même armée</small></button>' +
        '<button class="btn" data-action="editor">Éditeur de niveaux<small>Dessine, teste et partage par code</small></button>' +
        '<button class="btn" data-action="help">Commandes<small>Souris, clavier et écran tactile</small></button></div>' + this.pwaButtons() + '</div>');
      $('logo').getContext('2d').drawImage(NS.Sprites.frames[0].walk0.r, 0, 0);
    }

    showCampaign(world) {
      world = world || 0;
      this.worldView = world;
      const C = NS.Campaign, levels = C.all(), per = C.PER_WORLD, W = C.WORLDS[world];
      document.body.dataset.theme = W.theme;
      const tabs = C.WORLDS.map((w, i) => '<button class="btn' + (i === world ? ' on' : '') + '" data-action="world" data-arg="' + i + '">' + w.name + '</button>').join('');
      const cells = [];
      for (let i = world * per; i < (world + 1) * per; i++) {
        const l = levels[i], ok = C.Save.unlocked(i), s = C.Save.levelStars(l.id);
        const news = Object.entries(C.UNLOCK).some(([, r]) => r === l.rank);
        cells.push('<button class="btn lvl' + (ok ? '' : ' lock') + '" ' + (ok ? 'data-action="play" data-arg="' + i + '"' : 'disabled') + '>' + (i + 1) +
          '<span class="st">' + (ok ? '★'.repeat(s) + '☆'.repeat(3 - s) : 'verrouillé') + '</span>' + (news ? '<span class="new">nouveau</span>' : '') + '</button>');
      }
      this.openOverlay('<div class="card"><h2>Campagne <span class="stars-total">★ ' + C.Save.totalStars() + ' / 120</span></h2>' +
        '<div class="tabs">' + tabs + '</div><p class="world-title">' + W.name + ' : niveaux ' + (world * per + 1) + ' à ' + (world + 1) * per + '</p>' +
        '<div class="lvl-grid">' + cells.join('') + '</div>' +
        '<div class="row"><button class="btn" data-action="title">Retour</button><button class="btn" data-action="reset">Effacer la progression</button></div></div>');
    }

    showVersus() {
      const v = NS.Campaign.Save.data.vs, by = v.byDifficulty;
      const card = (id) => '<button class="btn diff" data-action="vs" data-arg="' + id + '"><b>' + DIFFICULTIES[id].name + '</b><small>' + DIFFICULTIES[id].text +
        (by[id] ? ' Victoires : ' + by[id].won + '/' + by[id].played + '.' : '') + '</small></button>';
      this.openOverlay('<div class="card"><h2>Contre l\'ordinateur</h2><p>Les deux armées partent des deux bouts d\'une carte symétrique : même parcours, mêmes stocks, mêmes points. ' +
        'Sauve plus de Bidules que lui. Tes armes servent aussi à saboter son chemin, mais ne tire pas devant tes propres Bidules.</p>' +
        '<div class="menu-grid">' + card('easy') + card('medium') + card('hard') + '</div>' +
        '<div class="row"><button class="btn" data-action="title">Retour</button></div></div>');
    }

    showPause() {
      if (this.kind === 'net') {
        return this.openOverlay('<div class="card"><h2>Partie en ligne</h2><p>La partie continue pour tout le monde pendant que ce menu est ouvert.</p>' +
          '<div class="row"><button class="btn primary" data-action="resume">Reprendre</button><button class="btn" data-action="net" data-arg="resign">Abandonner</button></div></div>');
      }
      this.openOverlay('<div class="card"><h2>Pause</h2><p>' + this.sim.def.name + '</p>' +
        '<div class="row"><button class="btn primary" data-action="resume">Reprendre</button>' +
        '<button class="btn" data-action="retry">Recommencer</button>' +
        '<button class="btn" data-action="help">Commandes</button>' +
        '<button class="btn" data-action="title">Menu principal</button></div></div>');
    }

    showHelp() {
      const back = this.sim ? 'resume' : 'title';
      this.openOverlay('<div class="card"><h2>Commandes</h2>' +
        '<p>Choisis une compétence dans la barre du bas, puis touche ou clique un Bidule. L\'onglet Arsenal donne accès aux armes : chacune coûte des points, a un stock limité et un temps de recharge.</p>' +
        '<div class="keys"><kbd>1 à 8</kbd><span>Compétence (ou arme, onglet Arsenal : 1 à 0)</span>' +
        '<kbd>Tab</kbd><span>Basculer compétences / arsenal</span>' +
        '<kbd>Entrée</kbd><span>Tirer le canon</span>' +
        '<kbd>B</kbd><span>Détoner mines et drone</span>' +
        '<kbd>P / Espace</kbd><span>Pause (ordres possibles en pause)</span>' +
        '<kbd>F</kbd><span>Vitesse x1, x2, x4</span>' +
        '<kbd>U / Ctrl+Z</kbd><span>Annuler (campagne)</span>' +
        '<kbd>Molette</kbd><span>Zoom (Maj + molette : défiler)</span>' +
        '<kbd>Glisser</kbd><span>Déplacer la carte</span>' +
        '<kbd>Flèches</kbd><span>Défiler</span>' +
        '<kbd>PgUp / PgDn</kbd><span>Cadence de la trappe</span>' +
        '<kbd>M</kbd><span>Couper le son</span>' +
        '<kbd>R</kbd><span>Recommencer</span>' +
        '<kbd>Échap</kbd><span>Menu</span></div>' +
        '<p>Sur mobile : un appui applique la compétence ou vise l\'arme, deux doigts pincent pour zoomer et glissent pour défiler.</p>' +
        '<div class="row"><button class="btn primary" data-action="' + back + '">' + (this.sim ? 'Retour au jeu' : 'Retour') + '</button></div></div>');
    }

    /** Lignes de pertes par cause pour un joueur. */
    lossRows(p) {
      return CAUSES.map(([label, keys]) => [label, keys.reduce((s, k) => s + (p.deadBy[k] || 0), 0)]).filter((r) => r[1] > 0);
    }

    showResult() {
      if (this.kind === 'custom') return this.showCustomResult();
      const sim = this.sim, me = sim.players[0], won = sim.status === 'won';
      const elapsed = fmtTime(sim.tick);
      let html;
      if (this.kind === 'vs') {
        const ai = sim.players[1];
        NS.Campaign.Save.recordVS(this.vsDifficulty, won);
        const row = (l, a, b) => '<tr><td>' + l + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
        const title = won ? 'Victoire !' : sim.status === 'draw' ? 'Égalité' : 'Défaite';
        html = '<div class="card"><h2>' + title + '</h2><div class="result-big ' + (won ? 'win' : 'lose') + '">' + me.saved + ' : ' + ai.saved + '</div>' +
          '<p>' + DIFFICULTIES[this.vsDifficulty].name + ', durée ' + elapsed + '.</p>' +
          '<table class="stats"><tr><th></th><th>Toi</th><th>Ordinateur</th></tr>' +
          row('Bidules sauvés', me.saved + ' / ' + me.count, ai.saved + ' / ' + ai.count) +
          row('Bidules perdus', me.dead, ai.dead) +
          row('Adversaires éliminés', me.stats.kills, ai.stats.kills) +
          row('Compétences données', me.stats.skills, ai.stats.skills) +
          row('Armes tirées', me.stats.weapons, ai.stats.weapons) +
          row('Points dépensés', me.stats.spent, ai.stats.spent) +
          this.lossRows(me).map((r) => row(r[0] + ' (toi)', r[1], '')).join('') +
          this.lossRows(ai).map((r) => row(r[0] + ' (lui)', '', r[1])).join('') +
          '</table><div class="row"><button class="btn primary" data-action="retry">Revanche</button><button class="btn" data-action="versus">Difficulté</button><button class="btn" data-action="title">Menu</button></div></div>';
      } else {
        const pct = Math.round((me.saved * 100) / me.count);
        const stars = NS.Campaign.stars(sim);
        const rec = won ? NS.Campaign.Save.record(sim.def.id, stars, pct) : false;
        const per = NS.Campaign.PER_WORLD, all = NS.Campaign.all();
        const next = this.levelIndex + 1 < all.length && won;
        const nextRank = this.levelIndex + 2;
        const news = Object.entries(NS.Campaign.UNLOCK).filter(([, r]) => r === nextRank && next).map(([id]) => id === 'climber' ? 'compétence Grimpeur' : NS.Weapons.byId[id].label);
        const rows = this.lossRows(me).map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
        html = '<div class="card"><h2>' + (won ? 'Mission réussie' : 'Mission ratée') + '</h2>' +
          '<div class="stars-big">' + [1, 2, 3].map((i) => '<i class="' + (i <= stars ? 'on' : '') + '">★</i>').join('') + '</div>' +
          '<div class="result-big ' + (won ? 'win' : 'lose') + '">' + pct + '%</div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i><u style="left:' + me.goal + '%"></u></div>' +
          (rec && stars === 3 ? '<p>Record : trois étoiles.</p>' : '') +
          '<table class="stats"><tr><th>Statistiques</th><th></th></tr>' +
          '<tr><td>Bidules sauvés</td><td>' + me.saved + ' / ' + me.count + ' (objectif ' + me.goal + '%)</td></tr>' +
          '<tr><td>Bidules perdus</td><td>' + me.dead + '</td></tr>' + rows +
          '<tr><td>Compétences données</td><td>' + me.stats.skills + '</td></tr>' +
          '<tr><td>Armes tirées</td><td>' + me.stats.weapons + '</td></tr>' +
          '<tr><td>Points dépensés</td><td>' + me.stats.spent + '</td></tr>' +
          '<tr><td>Temps</td><td>' + elapsed + ' / ' + fmtTime(sim.timeLimitTicks) + '</td></tr></table>' +
          (news.length ? '<div class="unlock">Prochain niveau : ' + news.join(', ') + ' débloqué.</div>' : '') +
          '<div class="stars-help"><small>★ objectif atteint, ★★ objectif + 20 points, ★★★ objectif + 35 points en moins de 75 % du temps.</small></div>' +
          '<div class="row">' + (next ? '<button class="btn primary" data-action="next">Niveau suivant</button>' : '') +
          '<button class="btn' + (next ? '' : ' primary') + '" data-action="retry">Rejouer</button>' +
          '<button class="btn" data-action="campaign" data-arg="' + Math.floor(this.levelIndex / per) + '">Niveaux</button></div></div>';
      }
      this.openOverlay(html);
    }
  }

  NS.OnlineUI.install(Game);
  NS.EditorUI.install(Game);
  NS.PWA.install(Game);
  window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
})(window);
