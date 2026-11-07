/**
 * assist.js
 * Tout ce qui aide le joueur ou prolonge une partie solo, greffé sur Game (comme online.js et editor.js) :
 *  - indices tirés du plan de solution du niveau (marqueur sur la carte), tutoriel guidé des niveaux 1 à 3,
 *    démonstration de la solution (le robot de solver.js joue) ;
 *  - détection « ça tourne en rond » : aucun Bidule n'explore de nouvel endroit depuis 12 s -> propositions ;
 *  - retour en arrière de 5 s (instantanés toutes les secondes) ;
 *  - rediffusions : revoir sa partie, la partager par lien, fantôme du meilleur passage ;
 *  - défi du jour et son classement ;
 *  - statistiques anonymes d'échec par niveau (compteurs envoyés au serveur du jeu) ;
 *  - liens directs #replay=… et #niveau=… ;
 *  - appui long sur un Bidule : sa fiche.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  const $ = (id) => document.getElementById(id);
  const TR = () => NS.C.TICK_RATE;
  const SOLO = ['campaign', 'custom', 'daily'];
  const WATCH = ['replay', 'demo'];
  const RING_EVERY = 30, RING_SIZE = 12, REWIND_S = 5;
  const STALL_S = 12;
  const REPLAY_KEY = 'bidules.replays.v1', DAILY_KEY = 'bidules.daily.v1', NAME_KEY = 'bidules.name', GHOST_KEY = 'bidules.ghost';
  const STATE_LABEL = {
    walk: 'marche', wait: 'attend', fall: 'tombe', block: 'bloqueur', build: 'bâtit', dig: 'creuse', mine: 'mine',
    bash: 'fore', climb: 'grimpe', jet: 'jetpack', zip: 'tyrolienne', grapple: 'grappin'
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (ticks) => { const s = Math.round(ticks / TR()); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function load(key, dflt) { try { const v = G.localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
  function store(key, v) { try { G.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }

  function install(Game) {
    const P = Game.prototype;

    P.solo = function () { return SOLO.includes(this.kind); };
    P.watching = function () { return WATCH.includes(this.kind); };

    /* ------------------------------ Mise en place ------------------------------ */

    P.assistInit = function () {
      this.ghostOn = load(GHOST_KEY, true) !== false;
      this.hintIcons = {};
      $('assist').addEventListener('click', (e) => {
        const a = e.target.closest('[data-assist]');
        if (!a) return;
        this.audio.unlock();
        this.hideAssist();
        if (a.dataset.assist !== 'close') this.action(a.dataset.assist);
      });
      window.addEventListener('hashchange', () => this.openDeepLink());
    };

    /** Appelé par begin() pour chaque nouvelle partie. */
    P.assistBegin = function () {
      this.orders = [];                 // compétences données par le joueur : {skill, x, y, tick} (indices)
      this.hintShown = new Set();       // règles du plan dévoilées
      this.hintsUsed = 0;
      this.tutoShown = new Set();
      this.ring = [];
      this.visited = new Set();
      this.stallT = 0;
      this.progressSig = '';
      this.stallShown = false;
      this.statSent = false;
      this.ghost = null;
      this.hideAssist();
      if (this.solo()) this.ring.push(this.sim.snapshot());
      if ((this.kind === 'campaign' || this.kind === 'daily') && this.ghostOn) this.startGhost();
    };

    /** Avant de quitter une partie : une partie abandonnée en cours compte dans les statistiques. */
    P.assistLeave = function () {
      const sim = this.sim;
      if (sim && sim.status === 'running' && sim.tick > 10 * TR()) this.sendStats('quit');
    };

    /* --------------------------------- Boucle ---------------------------------- */

    /** Avant chaque pas de simulation (pilote automatique : rediffusion ou démonstration). */
    P.assistBeforeStep = function () { if (this.driver) this.driver(); };

    /** Après chaque pas : fantôme, instantanés de retour arrière. */
    P.assistAfterStep = function () {
      const sim = this.sim;
      if (this.ghost) {
        const g = this.ghost.sim;
        while (g.status === 'running' && g.tick < sim.tick) { this.ghost.feed(); g.step(); g.events.length = 0; }
      }
      if (this.solo() && sim.tick % RING_EVERY === 0 && sim.status === 'running') {
        this.ring.push(sim.snapshot());
        if (this.ring.length > RING_SIZE) this.ring.shift();
      }
    };

    /** Une fois par image : tutoriel et détection de blocage. */
    P.assistFrame = function (dt, stepped) {
      const sim = this.sim;
      if (!sim || !this.solo() || sim.status !== 'running' || this.overlayOpen) return;
      if (this.kind === 'campaign' && this.levelIndex < 3) this.tutorial();
      if (!stepped) return;
      // Progrès = un Bidule entre dans une case de 8 px jamais visitée, ou un compteur bouge.
      const p = sim.players[this.me];
      const sig = p.released + '/' + p.saved + '/' + p.dead;
      let moved = sig !== this.progressSig;
      this.progressSig = sig;
      let alive = 0;
      for (const b of sim.bidules) {
        if (b.owner !== this.me) continue;
        alive++;
        const k = (b.x >> 3) * 4096 + (b.y >> 3);
        if (!this.visited.has(k)) { this.visited.add(k); moved = true; }
      }
      if (moved) { this.stallT = 0; if (this.stallShown) { this.stallShown = false; this.hideAssist(); } return; }
      this.stallT += stepped / TR();
      if (this.stallT > STALL_S && !this.stallShown && alive > 0) {
        this.stallShown = true;
        const plan = sim.def.plan;
        this.showAssist('On dirait que ça tourne en rond.', [
          plan ? ['hint', 'Indice'] : null,
          ['rewind', 'Revenir 5 s'],
          ['kill', 'Éliminer un Bidule'],
          ['retry', 'Recommencer'],
          ['close', '✕']
        ]);
      }
    };

    P.showAssist = function (msg, buttons) {
      $('assist-msg').textContent = msg;
      $('assist-btns').innerHTML = buttons.filter(Boolean).map(([a, l]) => '<button class="btn" data-assist="' + a + '">' + l + '</button>').join('');
      $('assist').hidden = false;
    };
    P.hideAssist = function () { $('assist').hidden = true; };

    /* --------------------------------- Indices --------------------------------- */

    P.planOf = function () { return this.sim && this.sim.def.plan; };

    /** Mémorise un ordre réussi du joueur (pour savoir quelles étapes du plan sont déjà couvertes). */
    P.noteOrder = function (skill, b) { this.orders.push({ skill, x: b.x, y: b.y, tick: this.sim.tick }); };

    P.hint = function () {
      const plan = this.planOf();
      if (!this.sim || !this.solo() || this.sim.status !== 'running') return;
      if (!plan || !plan.length) return this.hud.toast('Pas d\'indice pour ce niveau.', 2200);
      const i = NS.Solver.nextRule(plan, this.orders);
      if (i < 0) return this.hud.toast('Tu as déjà donné tout ce qu\'il faut. Si ça coince, essaie « Revenir 5 s » ou « Voir la solution » (menu).', 5000);
      this.hintShown.add(i);
      this.hintsUsed++;
      this.revealRule(i, 'Indice');
    };

    /** Dévoile une étape du plan : marqueur sur la carte, caméra centrée, explication. */
    P.revealRule = function (i, title) {
      const r = this.planOf()[i], s = NS.Skills.byId[r.skill];
      const key = NS.Skills.list.indexOf(s) + 1;
      const cx = (r.x0 + r.x1) / 2, cam = this.cam;
      cam.x = cx - cam.vw / cam.zoom / 2;
      cam.y = r.y - cam.vh / cam.zoom / 2;
      cam.clamp(); cam.snap(this.renderer.dpr);
      this.hud.toast(title + ' : donne un ' + s.label + ' (touche ' + key + ') au Bidule de tête quand il arrive sur le marqueur' +
        (r.dir === -1 ? ', en marchant vers la gauche' : '') + '.', 6500);
    };

    /** Tutoriel des trois premiers niveaux : l'étape suivante s'affiche quand un Bidule approche. */
    P.tutorial = function () {
      const plan = this.planOf(), sim = this.sim;
      if (!plan) return;
      const i = NS.Solver.nextRule(plan, this.orders);
      if (i < 0 || this.tutoShown.has(i)) return;
      const r = plan[i], dir = r.dir || 1;
      const near = sim.bidules.some((b) => b.owner === this.me && b.dir === dir && Math.abs(b.y - r.y) <= 12 &&
        ((dir > 0 && b.x >= r.x0 - 110 && b.x <= r.x1) || (dir < 0 && b.x <= r.x1 + 110 && b.x >= r.x0)));
      if (!near || (r.after && sim.tick < r.after - 60)) return;
      this.tutoShown.add(i);
      this.hintShown.add(i);
      if (this.speed > 1) this.setSpeed(1);
      const s = NS.Skills.byId[r.skill];
      if (this.skill !== r.skill && (sim.players[this.me].skills[r.skill] | 0) > 0) this.selectSkillIndex(NS.Skills.list.indexOf(s));
      this.revealRule(i, 'Étape ' + (i + 1) + '/' + plan.length);
    };

    /** Marqueurs des étapes dévoilées et non faites (dessinés dans le monde). */
    P.drawHints = function (ctx, s) {
      const plan = this.planOf();
      if (!plan || !this.hintShown || !this.hintShown.size || this.watching()) return;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
      ctx.lineWidth = 1 / s * this.renderer.dpr;
      for (const i of this.hintShown) {
        const r = plan[i];
        if (!r || NS.Solver.covered(r, this.orders)) continue;
        const x0 = r.x0 - 4, w = r.x1 - r.x0 + 8, dir = r.dir || 1, cx = Math.round((r.x0 + r.x1) / 2);
        ctx.strokeStyle = 'rgba(255,210,63,' + pulse.toFixed(2) + ')';
        ctx.strokeRect(x0 + 0.5, r.y - 13.5, w, 15);
        ctx.fillStyle = 'rgba(255,210,63,' + (0.18 * pulse).toFixed(2) + ')';
        ctx.fillRect(x0, r.y - 13, w, 14);
        const icon = this.hintIcons[r.skill] || (this.hintIcons[r.skill] = NS.Sprites.icon(r.skill));
        ctx.drawImage(icon, cx - 8, r.y - 34);
        ctx.fillStyle = '#ffd23f';                                   // flèche : sens de marche attendu
        for (let k = 0; k < 4; k++) ctx.fillRect(cx + dir * (10 + k), r.y - 27 + k, 1, 7 - 2 * k);
      }
    };

    /* ------------------------------- Retour arrière ------------------------------ */

    P.rewind = function () {
      const sim = this.sim;
      if (!sim || !this.solo() || !this.ring || !this.ring.length || this.overlayOpen) return;
      if (sim.status !== 'running') return;
      const target = sim.tick - REWIND_S * TR();
      let snap = this.ring[0];
      for (const s of this.ring) if (s.tick <= target) snap = s;
      sim.restore(snap);
      this.ring = this.ring.filter((s) => s.tick <= snap.tick);
      this.undoStack = this.undoStack.filter((s) => s.tick <= snap.tick);
      this.timeTravelled();
      this.hud.toast('Retour à ' + fmt(snap.tick), 1200);
    };

    /** Après une annulation ou un retour arrière : on remet l'affichage et les aides à l'heure de la simulation. */
    P.timeTravelled = function () {
      const t = this.sim.tick;
      this.renderer.invalidate(this.sim.terrain);
      this.fx.clear();
      this.acc = 0;
      this.orders = this.orders.filter((o) => o.tick <= t);
      if (this.ring) this.ring = this.ring.filter((s) => s.tick <= t);
      this.stallT = 0; this.stallShown = false; this.visited = new Set(); this.hideAssist();
      if (this.ghost && this.ghost.sim.tick > t) this.startGhost();
    };

    /* --------------------------- Rediffusions et fantôme --------------------------- */

    P.replayRef = function () {
      if (this.kind === 'campaign') return { k: 'campaign', i: this.levelIndex };
      if (this.kind === 'daily') return { k: 'daily', d: this.sim.def.daily };
      if (this.kind === 'custom' && this.customCode) return { k: 'custom', c: this.customCode };
      return null;
    };

    /** Fin d'une partie solo : garde la dernière rediffusion et la meilleure (gagnée) du niveau. */
    P.keepReplay = function () {
      const ref = this.replayRef();
      if (!ref) return null;
      const sim = this.sim, p = sim.players[0];
      const rep = NS.Replay.record(sim, ref), code = NS.Replay.encode(rep);
      const all = load(REPLAY_KEY, {}), id = sim.def.id, cur = all[id] || {};
      cur.last = code;
      const score = sim.status === 'won' ? p.saved * 100000 - sim.tick : -1;
      if (score >= 0 && (cur.bestScore === undefined || score > cur.bestScore)) { cur.best = code; cur.bestScore = score; cur.bestPct = Math.round((p.saved * 100) / p.count); }
      all[id] = cur;
      const ids = Object.keys(all);                    // au plus 60 niveaux mémorisés
      if (ids.length > 60) delete all[ids[0]];
      store(REPLAY_KEY, all);
      this.lastReplay = code;
      return code;
    };

    P.startGhost = function () {
      this.ghost = null;
      const saved = load(REPLAY_KEY, {})[this.sim.def.id];
      if (!saved || !saved.best) return;
      try {
        const rep = NS.Replay.decode(saved.best);
        if (rep.p !== NS.Net.PROTOCOL) return;                       // règles changées depuis : le fantôme serait faux
        this.ghost = NS.Replay.player(rep, this.sim.def);
        this.ghost.pct = saved.bestPct;
        const g = this.ghost.sim, t = this.sim.tick;
        while (g.status === 'running' && g.tick < t) { this.ghost.feed(); g.step(); g.events.length = 0; }
      } catch (e) { this.ghost = null; }
    };

    P.ghostBidules = function () { return this.ghost && this.ghostOn ? this.ghost.sim.bidules : null; };

    P.toggleGhost = function () {
      this.ghostOn = !this.ghostOn;
      store(GHOST_KEY, this.ghostOn);
      if (this.ghostOn && this.sim && !this.ghost && (this.kind === 'campaign' || this.kind === 'daily')) this.startGhost();
      this.hud.toast(this.ghostOn ? (this.ghost ? 'Fantôme : ton meilleur passage (' + this.ghost.pct + '%)' : 'Fantôme activé (dès que tu auras gagné ce niveau)') : 'Fantôme désactivé', 2400);
    };

    /** Lance une rediffusion (code ou objet). */
    P.startReplay = function (code) {
      let rep, def;
      try { rep = typeof code === 'string' ? NS.Replay.decode(code) : code; def = NS.Replay.defOf(rep.ref); } catch (e) { rep = null; }
      if (!rep || !def) { this.showTitle(); return this.hud.toast('Rediffusion illisible.', 3000); }
      if (rep.p !== NS.Net.PROTOCOL) this.hud.toast('Rediffusion d\'une autre version du jeu : elle peut diverger.', 4000);
      const pl = NS.Replay.player(rep, def);
      this.watchFrom = { rep, ref: rep.ref, code: typeof code === 'string' ? code : NS.Replay.encode(rep) };
      this.ai = null;
      this.begin(def, 'replay', pl.sim);
      this.driver = pl.feed;
      this.setSpeed(2);
      this.hud.toast('Rediffusion : ' + def.name + '. Les ordres sont rejoués à l\'identique.', 3500);
    };

    /** Démonstration : le robot joue le plan de solution du niveau en cours. */
    P.startDemo = function () {
      const sim = this.sim, plan = sim && sim.def.plan;
      if (!plan || !(this.solo() || this.kind === 'demo')) return this.hud.toast('Pas de solution enregistrée pour ce niveau.', 2500);
      const from = this.kind === 'demo' ? this.watchFrom : { kind: this.kind, levelIndex: this.levelIndex, def: sim.def };
      if (this.kind !== 'demo' && sim.status === 'running') this.sendStats('quit', true);
      this.ai = null;
      this.begin(from.def, 'demo');
      this.watchFrom = from;
      const done = new Set();
      this.driver = () => NS.Solver.play(this.sim, plan, done, 0);
      this.setSpeed(2);
      this.hud.toast('Démonstration de la solution (une solution parmi d\'autres). Rien n\'est enregistré.', 4500);
    };

    /** Rejouer le niveau d'une rediffusion ou d'une démonstration, pour de vrai. */
    P.playWatched = function () {
      const w = this.watchFrom || {};
      if (this.kind === 'demo') {
        if (w.kind === 'campaign') return this.startCampaign(w.levelIndex);
        if (w.kind === 'daily') return this.startDaily();
        return this.startCustom(w.def, this.customCode);
      }
      const ref = w.ref || {};
      if (ref.k === 'campaign') return this.startCampaign(ref.i);
      if (ref.k === 'daily') return ref.d === NS.Daily.today() ? this.startDaily() : this.showDaily();
      if (ref.k === 'custom') return this.startCustom(NS.Loader.decodeLevel(ref.c), ref.c);
      this.showTitle();
    };

    P.shareLink = async function (hash, what) {
      const url = location.origin + location.pathname + '#' + hash;
      let ok = false;
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) { try { await navigator.share({ title: 'Opération Mirage', url }); return; } catch (e) { /* annulé */ } }
      try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { ok = false; }
      if (ok) this.hud.toast('Lien ' + what + ' copié.', 2500);
      else window.prompt('Copie ce lien :', url);
    };

    /** Liens directs : #replay=CODE (rediffusion), #niveau=CODE ou #niveau=NIVxxxx (niveau perso). */
    P.openDeepLink = async function () {
      const m = /^#(replay|niveau)=(.+)$/.exec(location.hash || '');
      if (!m) return;
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
      if (m[1] === 'replay') return this.startReplay(m[2]);
      let code = decodeURIComponent(m[2]);
      try {
        if (/^NIV[0-9A-Z]{3,9}$/i.test(code)) {
          const r = await fetch(this.apiBase() + '/api/levels/' + code.toUpperCase());
          if (!r.ok) throw new Error('niveau introuvable');
          code = (await r.json()).code;
        }
        this.startCustom(NS.Loader.decodeLevel(code), code);
      } catch (e) { this.hud.toast('Niveau partagé illisible : ' + e.message, 3500); }
    };

    /* ------------------------------- Défi du jour ------------------------------- */

    P.startDaily = function () {
      const date = NS.Daily.today();
      this.ai = null;
      const def = NS.Daily.def(date);
      this.begin(def, 'daily');
      this.hud.toast(def.name + ' : ' + def.count + ' Bidules, objectif ' + def.goal + '%. ' + def.hint, 6000);
    };

    P.showDaily = function () {
      const date = NS.Daily.today(), mine = load(DAILY_KEY, {})[date];
      document.body.dataset.theme = 'desert';
      this.openOverlay('<div class="card"><h2>Défi du jour</h2><p>' + NS.Daily.label(date) + ' : le même niveau pour tout le monde aujourd\'hui. ' +
        'Gagne-le et inscris ton score : le serveur rejoue ta partie pour le vérifier.</p>' +
        (mine ? '<p>Ton meilleur score du jour : <b>' + mine.saved + '/' + mine.count + '</b> en ' + fmt(mine.tick) + '.</p>' : '') +
        '<div id="daily-board" class="board"><small>Chargement du classement…</small></div>' +
        '<div class="row"><button class="btn primary" data-action="daily-play">Jouer</button><button class="btn" data-action="title">Retour</button></div></div>');
      this.loadBoard(date);
    };

    P.loadBoard = async function (date, list) {
      const el = $('daily-board');
      if (!el) return;
      const base = this.apiBase();
      if (!list) {
        if (!base) { el.innerHTML = '<small>Classement indisponible hors ligne.</small>'; return; }
        try { const r = await fetch(base + '/api/daily/' + date); list = (await r.json()).board; } catch (e) { el.innerHTML = '<small>Classement indisponible.</small>'; return; }
      }
      const me = (load(NAME_KEY, '') || '').toLowerCase();
      el.innerHTML = list.length
        ? '<table class="stats"><tr><th>#</th><th>Joueur</th><th>Sauvés</th><th>Temps</th></tr>' + list.map((e, i) =>
          '<tr' + (e.name.toLowerCase() === me ? ' class="me"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(e.name) + '</td><td>' + e.saved + '/' + e.count + '</td><td>' + fmt(e.tick) + '</td></tr>').join('') + '</table>'
        : '<small>Personne n\'a encore réussi le défi aujourd\'hui. À toi !</small>';
    };

    P.showDailyResult = function () {
      const sim = this.sim, p = sim.players[0], won = sim.status === 'won', date = sim.def.daily;
      const pct = Math.round((p.saved * 100) / p.count);
      if (won) {
        const all = load(DAILY_KEY, {}), cur = all[date];
        if (!cur || p.saved > cur.saved || (p.saved === cur.saved && sim.tick < cur.tick)) all[date] = { saved: p.saved, count: p.count, tick: sim.tick };
        for (const d of Object.keys(all)) if (d < NS.Daily.today(new Date(Date.now() - 40 * 86400000))) delete all[d];
        store(DAILY_KEY, all);
      }
      const canSend = won && this.apiBase() && date === NS.Daily.today();
      this.openOverlay('<div class="card"><h2>' + (won ? 'Défi réussi' : 'Défi raté') + '</h2>' +
        '<div class="result-big ' + (won ? 'win' : 'lose') + '">' + pct + '%</div>' +
        '<p>' + p.saved + ' Bidules sauvés sur ' + p.count + ' (objectif ' + p.goal + '%), en ' + fmt(sim.tick) + '.</p>' +
        (canSend ? '<div class="row"><input id="daily-name" class="wide-input" maxlength="16" placeholder="Ton nom" value="' + esc(load(NAME_KEY, '')) + '">' +
          '<button class="btn primary" data-action="daily-send">Inscrire mon score</button></div>' : '') +
        '<div id="daily-board" class="board"></div>' +
        '<div class="row"><button class="btn' + (canSend ? '' : ' primary') + '" data-action="retry">Rejouer</button><button class="btn" data-action="watch">Revoir</button>' +
        '<button class="btn" data-action="share-replay">Partager</button><button class="btn" data-action="title">Menu</button></div></div>');
      if (!canSend) this.loadBoard(date);
    };

    P.sendDaily = async function () {
      const input = $('daily-name'), name = ((input && input.value) || '').trim().slice(0, 16);
      if (!name) { if (input) input.focus(); return this.refuse('Choisis un nom'); }
      store(NAME_KEY, name);
      const date = this.sim.def.daily, el = $('daily-board');
      if (el) el.innerHTML = '<small>Vérification de ta partie par le serveur…</small>';
      try {
        const r = await fetch(this.apiBase() + '/api/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, name, replay: this.lastReplay }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        this.hud.toast('Score inscrit : ' + j.rank + (j.rank === 1 ? 'er' : 'e') + ' du jour.', 4000);
        const btn = document.querySelector('[data-action="daily-send"]');
        if (btn) btn.disabled = true;
        this.loadBoard(date, j.board);
      } catch (e) { if (el) el.innerHTML = '<small>Envoi impossible : ' + esc(e.message) + '</small>'; }
    };

    /* ------------------------------ Statistiques ------------------------------ */

    /** Compteurs anonymes par niveau (campagne et défi) : résultat, % sauvés, causes de pertes, indices. */
    P.sendStats = function (result, demo) {
      const sim = this.sim;
      if (this.statSent || !sim || !(this.kind === 'campaign' || this.kind === 'daily')) return;
      const base = this.apiBase && this.apiBase();
      if (!base) return;
      this.statSent = true;
      const p = sim.players[0];
      const body = JSON.stringify({
        level: this.kind === 'daily' ? 'daily' : sim.def.id, result, pct: Math.round((p.saved * 100) / p.count),
        hints: this.hintsUsed, demo: !!demo, causes: p.deadBy
      });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(base + '/api/stats', new Blob([body], { type: 'application/json' }))) return;
        fetch(base + '/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      } catch (e) { /* tant pis */ }
    };

    /* ------------------------------ Fiche d'un Bidule ------------------------------ */

    /** Appui long : ce que fait le Bidule touché. */
    P.inspect = function (sx, sy) {
      if (!this.sim || this.overlayOpen) return;
      const b = this.pickOwn(sx, sy, true);
      if (!b) return;
      const tags = [STATE_LABEL[b.state] || b.state];
      if (b.floater) tags.push('parachute');
      if (b.climber) tags.push('grimpeur');
      if (b.bomb > 0) tags.push('explose dans ' + Math.ceil(b.bomb / TR()) + ' s');
      if (b.state === 'build') tags.push(b.bricks + ' briques');
      if (b.state === 'block') tags.push('touche-le pour le libérer');
      this.hoverId = b.id; this.hoverOk = true;
      this.hud.toast('Bidule n°' + b.id + ' : ' + tags.join(', ') + '.', 2600);
      if (navigator.vibrate) navigator.vibrate(15);
    };

    /* ---------------------------------- Actions ---------------------------------- */

    P.assistAction = function (name) {
      switch (name) {
        case 'daily': this.showDaily(); break;
        case 'daily-play': this.startDaily(); break;
        case 'daily-send': this.sendDaily(); break;
        case 'hint': this.closeOverlay(); this.hint(); break;
        case 'demo': this.startDemo(); break;
        case 'rewind': this.closeOverlay(); this.rewind(); break;
        case 'kill': this.closeOverlay(); if (!this.killMode) this.toggleKill(); break;
        case 'ghost': this.toggleGhost(); this.showPause(); break;
        case 'watch': if (this.watching()) this.startReplay(this.watchFrom.code); else if (this.lastReplay) this.startReplay(this.lastReplay); break;
        case 'share-replay': {
          const code = this.watching() ? this.watchFrom && this.watchFrom.code : this.lastReplay;
          if (code) this.shareLink('replay=' + code, 'de la rediffusion');
          break;
        }
        case 'play-watched': this.playWatched(); break;
      }
    };

    /** Écran de fin d'une rediffusion ou d'une démonstration. */
    P.showWatchResult = function () {
      const sim = this.sim, p = sim.players[0], pct = Math.round((p.saved * 100) / p.count), demo = this.kind === 'demo';
      this.openOverlay('<div class="card"><h2>' + (demo ? 'Fin de la démonstration' : 'Fin de la rediffusion') + '</h2>' +
        '<div class="result-big ' + (sim.status === 'won' ? 'win' : 'lose') + '">' + pct + '%</div>' +
        '<p>' + p.saved + ' sauvés sur ' + p.count + ', en ' + fmt(sim.tick) + '.</p>' +
        '<div class="row"><button class="btn primary" data-action="play-watched">À moi de jouer</button>' +
        (demo ? '<button class="btn" data-action="demo">Revoir</button>' : '<button class="btn" data-action="watch">Revoir</button><button class="btn" data-action="share-replay">Partager</button>') +
        '<button class="btn" data-action="title">Menu</button></div></div>');
    };
  }

  NS.AssistUI = { install };
})(typeof window !== 'undefined' ? window : globalThis);
