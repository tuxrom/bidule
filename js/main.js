/**
 * main.js
 * Chef d'orchestre : crée les modules, pilote la boucle principale et les
 * écrans (titre, niveaux, pause, résultat).
 *
 * Boucle : requestAnimationFrame mesure le temps réel écoulé, l'accumule, et
 * lance autant de pas de simulation FIXES (1/30 s) que nécessaire. Le rendu a
 * lieu une fois par image, quel que soit le nombre de pas : la vitesse x2/x4
 * ne fait que multiplier le temps accumulé, jamais la durée d'un pas.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const $ = (id) => document.getElementById(id);
  const STEP = 1 / NS.C.TICK_RATE;
  const MAX_STEPS_PER_FRAME = 8;     // garde-fou : on lâche du retard plutôt que de geler l'écran
  const UNDO_LIMIT = 30;

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

      this.sim = null;
      this.levelIndex = 0;
      this.selected = null;
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
      this.slowFrames = 0;       // image lentes consécutives (qualité adaptative)

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
      $('btn-pause').onclick = () => { this.audio.unlock(); this.togglePause(); };
      $('btn-x2').onclick = () => this.setSpeed(this.speed === 2 ? 1 : 2);
      $('btn-x4').onclick = () => this.setSpeed(this.speed === 4 ? 1 : 4);
      $('btn-undo').onclick = () => this.undo();
      $('btn-mute').onclick = () => { this.audio.unlock(); this.toggleMute(); };
      $('btn-menu').onclick = () => this.toggleMenu();
      $('btn-rate-dec').onclick = () => this.adjustRate(-5);
      $('btn-rate-inc').onclick = () => this.adjustRate(5);
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
        case 'levels': this.showLevels(); break;
        case 'play': this.startLevel(Number(arg)); break;
        case 'next': this.startLevel(this.levelIndex + 1); break;
        case 'retry': this.startLevel(this.levelIndex); break;
        case 'resume': this.closeOverlay(); break;
        case 'help': this.showHelp(); break;
        case 'title': this.showTitle(); break;
      }
    }

    /* --------------------------------- Niveaux --------------------------------- */

    startLevel(i) {
      const def = NS.Loader.levels[i];
      if (!def) return this.showLevels();
      this.levelIndex = i;
      this.sim = new NS.Simulation(def);
      this.renderer.resize();
      this.renderer.setLevel(this.sim);
      this.cam.setWorld(def.width, def.height);
      // Zoom de départ : environ 200 pixels de monde de large sur mobile, plus large sur grand écran.
      const z = Math.min(this.cam.vw / 260, this.cam.vh / 200);
      this.cam.zoom = Math.max(this.cam.minZoom(), Math.min(4, Math.max(2, z)));
      // Cadrage initial sur la trappe : on voit d'où partent les Bidules et le sol devant eux.
      const vwW = this.cam.vw / this.cam.zoom, vwH = this.cam.vh / this.cam.zoom;
      this.cam.x = def.hatch.x - vwW * 0.3;
      this.cam.y = def.hatch.y - vwH * 0.4;
      this.cam.clamp();
      this.cam.snap(this.renderer.dpr);
      this.fx.clear();
      this.undoStack = [];
      this.acc = 0;
      this.paused = false;
      this.speed = 1;
      this.resultTimer = 0;
      this.hoverId = 0;
      const first = NS.Skills.list.find((s) => (def.skills[s.id] | 0) > 0);
      this.selected = first ? first.id : null;
      this.hud.setLevelName(def.name);
      this.hud.setPaused(false);
      this.hud.setSpeed(1);
      this.closeOverlay();
      this.audio.unlock();
      this.audio.startMusic();
      if (def.hint) this.hud.toast(def.hint, 6500);
    }

    restart() { if (this.sim) this.startLevel(this.levelIndex); }

    /* ---------------------------------- Actions --------------------------------- */

    selectSkillIndex(i) {
      const s = NS.Skills.list[i];
      if (!s || !this.sim || (this.sim.skills[s.id] | 0) <= 0) return;
      this.selected = s.id;
      this.audio.sfx('select');
    }

    togglePause() { this.setPaused(!this.paused); }
    setPaused(p) {
      if (!this.sim) return;
      this.paused = p;
      this.hud.setPaused(p);
    }
    setSpeed(s) { this.speed = s; this.hud.setSpeed(s); }
    cycleSpeed() { this.setSpeed(this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1); }
    toggleMute() { this.audio.setMuted(!this.audio.muted); this.hud.setMuted(this.audio.muted); }
    zoomStep(f) { this.cam.zoomAt(this.cam.vw / 2, this.cam.vh / 2, this.cam.zoom * f); this.cam.snap(this.renderer.dpr); }

    adjustRate(d) {
      if (!this.sim || this.overlayOpen) return;
      this.sim.issue({ type: 'rate', value: this.sim.rate + d });
    }

    /** Annule la dernière compétence : retour exact à l'état d'avant l'ordre. */
    undo() {
      if (!this.sim || this.overlayOpen || !this.undoStack.length) return;
      this.sim.restore(this.undoStack.pop());
      this.renderer.invalidate(this.sim.terrain);
      this.fx.clear();
      this.acc = 0;
      this.hud.toast('Dernière action annulée', 1200);
    }

    /** Choisit le Bidule visé : le plus proche du point, de préférence capable de recevoir la compétence. */
    pick(sx, sy, touch) {
      const w = this.cam.screenToWorld(sx, sy);
      const reach = (touch ? 24 : 10) / this.cam.zoom + 5;
      let best = null, bestScore = Infinity;
      for (const b of this.sim.bidules) {
        const d = Math.hypot(b.x - w.x, b.y - 5 - w.y);
        if (d > reach) continue;
        const ok = this.selected && this.sim.canAssign(b, this.selected);
        const score = d + (ok ? 0 : 1000);
        if (score < bestScore) { bestScore = score; best = b; }
      }
      return best;
    }

    tap(sx, sy, touch) {
      if (!this.sim || this.overlayOpen || this.sim.status !== 'running') return;
      const b = this.pick(sx, sy, touch);
      if (!b || !this.selected) return;
      if (!this.sim.canAssign(b, this.selected)) { this.audio.sfx('deny'); return; }
      this.undoStack.push(this.sim.snapshot());
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.sim.issue({ type: 'assign', id: b.id, skill: this.selected });
      this.flushEvents();
    }

    hover(sx, sy) {
      if (!this.sim || sx < 0) { this.hoverId = 0; this.canvas.classList.remove('can-assign'); return; }
      const b = this.pick(sx, sy, false);
      this.hoverId = b ? b.id : 0;
      this.hoverOk = !!(b && this.selected && this.sim.canAssign(b, this.selected));
      this.canvas.classList.toggle('can-assign', this.hoverOk);
    }

    /* ----------------------------------- Boucle ---------------------------------- */

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

    /** Distribue les événements de la simulation à l'audio et aux particules. */
    flushEvents() {
      const ev = this.sim.events;
      for (let i = 0; i < ev.length; i++) {
        this.fx.handle(ev[i]);
        this.audio.handle(ev[i]);
        if (ev[i].type === 'end') this.audio.sfx(ev[i].extra === 'won' ? 'win' : 'lose');
      }
      ev.length = 0;
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.time += dt;
      this.adaptQuality(dt);
      this.input.update(dt);
      const sim = this.sim;
      if (!sim) return;

      const running = !this.paused && !this.overlayOpen && sim.status === 'running';
      if (running) {
        this.acc += dt * this.speed;
        let n = 0;
        while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) {
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

      this.renderer.draw(sim, this.fx, { time: this.time, hoverId: this.hoverId, hoverOk: this.hoverOk });
      this.hud.update(sim, this.selected, this.undoStack.length > 0);

      if (sim.status !== 'running' && !this.overlayOpen) {
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

    best() {
      try { return JSON.parse(localStorage.getItem('bidules.best') || '{}'); } catch (e) { return {}; }
    }
    saveBest(id, pct) {
      const b = this.best();
      if ((b[id] || 0) < pct) b[id] = pct;
      try { localStorage.setItem('bidules.best', JSON.stringify(b)); } catch (e) { /* stockage indisponible */ }
    }

    showTitle() {
      this.openOverlay(
        '<div class="card"><canvas class="logo" id="logo" width="8" height="10"></canvas>' +
        '<h1>Opération Mirage</h1><div class="sub">Les Bidules traversent le désert</div>' +
        '<p>Guide ta troupe de petits soldats-robots jusqu\'à la sortie. Ils marchent sans jamais s\'arrêter : ' +
        'à toi de leur confier les bonnes compétences pour creuser, bâtir, bloquer et franchir les pièges.</p>' +
        '<div class="row"><button class="btn primary" data-action="levels">Jouer</button>' +
        '<button class="btn" data-action="help">Commandes</button></div></div>');
      const lc = $('logo').getContext('2d');
      lc.drawImage(NS.Sprites.frames.walk0.r, 0, 0);
    }

    showLevels() {
      const best = this.best();
      const cards = NS.Loader.levels.map((l, i) =>
        '<button class="btn level-card" data-action="play" data-arg="' + i + '">' +
        '<span class="num">' + (i + 1) + '</span><span class="meta"><b>' + l.name + '</b><small>' +
        l.count + ' Bidules, objectif ' + l.goal + '%, ' + Math.floor(l.timeLimit / 60) + ' min</small></span>' +
        (best[l.id] ? '<span class="best">' + best[l.id] + '%</span>' : '') + '</button>').join('');
      this.openOverlay('<div class="card"><h2>Choisis une mission</h2><div class="levels">' + cards + '</div>' +
        '<div class="row"><button class="btn" data-action="title">Retour</button></div></div>');
    }

    showPause() {
      this.openOverlay('<div class="card"><h2>Pause</h2><p>' + NS.Loader.levels[this.levelIndex].name + '</p>' +
        '<div class="row"><button class="btn primary" data-action="resume">Reprendre</button>' +
        '<button class="btn" data-action="retry">Recommencer</button>' +
        '<button class="btn" data-action="help">Commandes</button>' +
        '<button class="btn" data-action="levels">Niveaux</button></div></div>');
    }

    showHelp() {
      const back = this.sim ? 'resume' : 'title';
      this.openOverlay('<div class="card"><h2>Commandes</h2>' +
        '<p>Choisis une compétence dans la barre du bas, puis touche ou clique un Bidule. ' +
        'Atteins l\'objectif de Bidules sauvés avant la fin du temps.</p>' +
        '<div class="keys"><kbd>1 à 7</kbd><span>Choisir une compétence</span>' +
        '<kbd>P / Espace</kbd><span>Pause (on peut donner des ordres en pause)</span>' +
        '<kbd>F</kbd><span>Vitesse x1, x2, x4</span>' +
        '<kbd>U / Ctrl+Z</kbd><span>Annuler la dernière compétence</span>' +
        '<kbd>Molette</kbd><span>Zoom (Maj + molette : défiler)</span>' +
        '<kbd>Glisser</kbd><span>Déplacer la carte</span>' +
        '<kbd>Flèches</kbd><span>Défiler</span>' +
        '<kbd>+ / -</kbd><span>Zoom</span>' +
        '<kbd>PgUp / PgDn</kbd><span>Cadence de la trappe</span>' +
        '<kbd>M</kbd><span>Couper le son</span>' +
        '<kbd>R</kbd><span>Recommencer</span>' +
        '<kbd>Échap</kbd><span>Menu</span></div>' +
        '<p>Sur mobile : un appui applique la compétence, deux doigts pincent pour zoomer et glissent pour défiler.</p>' +
        '<div class="row"><button class="btn primary" data-action="' + back + '">' + (this.sim ? 'Retour au jeu' : 'Retour') + '</button></div></div>');
    }

    showResult() {
      const sim = this.sim, won = sim.status === 'won';
      const pct = Math.round((sim.saved * 100) / sim.count);
      if (won) this.saveBest(sim.def.id, pct);
      const hasNext = this.levelIndex + 1 < NS.Loader.levels.length;
      this.openOverlay('<div class="card"><h2>' + (won ? 'Mission réussie' : 'Mission ratée') + '</h2>' +
        '<div class="result-big ' + (won ? 'win' : 'lose') + '">' + pct + '%</div>' +
        '<p>' + sim.saved + ' Bidules sauvés sur ' + sim.count + ', objectif ' + sim.def.goal + '%.</p>' +
        '<div class="bar"><i style="width:' + pct + '%"></i><u style="left:' + sim.def.goal + '%"></u></div>' +
        '<div class="row">' +
        (won && hasNext ? '<button class="btn primary" data-action="next">Niveau suivant</button>' : '') +
        '<button class="btn' + (won && hasNext ? '' : ' primary') + '" data-action="retry">Rejouer</button>' +
        '<button class="btn" data-action="levels">Niveaux</button></div></div>');
    }
  }

  window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
})(window);
