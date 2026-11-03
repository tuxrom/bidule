/**
 * online.js
 * Interface du jeu en ligne : écran de connexion, salon (joueurs, état prêt, réglages, chat par emojis), entrée en
 * partie, bandeau de connexion, résultats. Ajoute ses méthodes à la classe Game (voir main.js) : la logique réseau
 * elle-même est dans net/netclient.js et ne sait rien du DOM.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const $ = (id) => document.getElementById(id);
  const NET = NS.Net;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const THEMES = { desert: 'Désert', ruins: 'Ville en ruines', arctic: 'Arctique', orbital: 'Orbital' };

  function install(Game) {
    const P = Game.prototype;

    /* --------------------------------- Connexion --------------------------------- */

    P.serverUrl = function () {
      const saved = store('bidules.server');
      if (saved) return saved;
      if (/^https?:$/.test(location.protocol)) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      return '';
    };

    P.ensureNet = function (url) {
      if (this.net && this.netUrl === url && this.net.wantOpen) return this.net;
      if (this.net) this.net.close();
      this.netUrl = url;
      const lag = Number(new URLSearchParams(location.search).get('lag')) || 0;      // ?lag=120 : latence artificielle par sens (test)
      this.net = new NS.NetSession({ url, WebSocketImpl: lag ? NS.NetSession.lagSocket(lag, lag / 3) : undefined, name: store('bidules.name') || 'Joueur', storage: sessionStorage, on: (t, d) => this.onNet(t, d) });
      this.net.connect();
      return this.net;
    };

    /** Exécute `fn` dès que la connexion est établie (tout de suite si elle l'est déjà). */
    P.whenOnline = function (fn) {
      if (this.net && this.net.state === 'open' && this.net.token) fn();
      else this.pendingNet = fn;
    };

    P.showOnline = function () {
      document.body.dataset.theme = 'desert';
      const url = this.serverUrl();
      const needUrl = !/^https?:$/.test(location.protocol);
      const code = new URLSearchParams(location.search).get('salon') || '';
      this.openOverlay('<div class="card"><h2>Jouer en ligne</h2>' +
        '<p>Duel : chacun mène son armée sur une carte symétrique. Coopération : deux joueurs, une armée, des rôles répartis.</p>' +
        '<label class="field">Ton nom<input id="net-name" maxlength="16" value="' + esc(store('bidules.name') || '') + '" placeholder="Joueur"></label>' +
        (needUrl || store('bidules.server') ? '<label class="field">Serveur<input id="net-server" value="' + esc(url) + '" placeholder="wss://mon-serveur.example/ws"></label>' : '') +
        '<div id="netstate" class="netstate">' + (navigator.onLine === false ? 'Hors ligne : le jeu en ligne est indisponible.' : '') + '</div>' +
        '<div class="menu-grid"><button class="btn primary" data-action="net" data-arg="create-vs">Créer un duel<small>Tu reçois un code à 4 lettres à donner à ton adversaire</small></button>' +
        '<button class="btn" data-action="net" data-arg="create-coop">Créer une partie coopérative<small>Même armée, compétences réparties entre vous deux</small></button></div>' +
        '<div class="row"><input id="net-code" class="code" maxlength="4" placeholder="CODE" value="' + esc(code.toUpperCase()) + '" autocapitalize="characters" autocomplete="off">' +
        '<button class="btn" data-action="net" data-arg="join">Rejoindre</button></div>' +
        '<div class="row"><button class="btn" data-action="title">Retour</button></div></div>');
      if (code && url) setTimeout(() => this.netAction('join'), 50);
    };

    P.netStatus = function (text) { const e = $('netstate'); if (e) e.textContent = text; };

    P.netAction = function (arg) {
      const act = (a) => {
        if (a === 'create-vs') return this.net.create('vs');
        if (a === 'create-coop') return this.net.create('coop');
        if (a === 'join') return this.net.join(($('net-code') && $('net-code').value) || this.pendingCode || '');
      };
      switch (arg) {
        case 'create-vs': case 'create-coop': case 'join': {
          const nameEl = $('net-name');
          if (nameEl) store('bidules.name', nameEl.value.trim().slice(0, 16));
          const srv = $('net-server');
          if (srv) store('bidules.server', srv.value.trim());
          const url = this.serverUrl();
          if (!url) return this.netStatus('Indique l\'adresse du serveur (ws://...).');
          if (arg === 'join' && !/^[A-Za-z]{4}$/.test($('net-code').value.trim())) return this.netStatus('Le code a 4 lettres.');
          this.netStatus('Connexion…');
          this.ensureNet(url);
          this.whenOnline(() => act(arg));
          break;
        }
        case 'ready': this.net.ready(!this.myReady()); break;
        case 'leave': this.net.leave(); this.net.close(); this.net = null; this.kind = 'menu'; this.showOnline(); break;
        case 'back': this.kind = 'menu'; document.body.classList.remove('net'); this.hideNetChrome(); this.showLobby(); break;
        case 'quit': this.quitNet(); break;
        case 'resign': if (confirm('Abandonner la partie ?')) { this.net.resign(); } break;
      }
    };

    P.quitNet = function () {
      if (this.net) { this.net.leave(); this.net.close(); this.net = null; }
      this.kind = 'menu'; this.sim = null;
      document.body.classList.remove('net');
      this.hideNetChrome();
      this.showTitle();
    };

    P.myReady = function () { const r = this.net && this.net.room; return !!(r && r.players[r.you] && r.players[r.you].ready); };

    /* ------------------------------ Événements réseau ------------------------------ */

    P.onNet = function (type, d) {
      switch (type) {
        case 'welcome': if (this.pendingNet) { const f = this.pendingNet; this.pendingNet = null; f(); } break;
        case 'state':
          if (d === 'reconnecting') this.netStatus('Connexion perdue, nouvelle tentative…');
          if (d === 'closed' && !this.net.wantOpen) break;
          this.updateNetChrome();
          break;
        case 'room': if (this.kind !== 'net') { if (this.kind === 'net-over' && !this.overlayOpen) break; this.showLobby(); } this.updateNetChrome(); break;
        case 'countdown': { const e = $('lobby-count'); if (e) e.textContent = d.n > 0 ? 'La partie commence dans ' + d.n + '…' : 'Partez !'; break; }
        case 'start': this.startNet(d); break;
        case 'end': this.updateNetChrome(); break;
        case 'peer':
          if (d.status === 'left') { this.coopSolo = true; this.hud.toast('Ton partenaire est parti : tu as maintenant tous les rôles.', 4500); }
          else if (d.status === 'disconnected') this.hud.toast('Déconnexion de ton ' + (this.net.config && this.net.config.mode === 'coop' ? 'partenaire' : 'adversaire') + ' : la partie est suspendue.', 4000);
          else if (d.status === 'reconnected') this.hud.toast('Il est de retour.', 2000);
          this.updateNetChrome();
          break;
        case 'lost':
          this.kind = 'menu'; document.body.classList.remove('net'); this.hideNetChrome();
          this.showOnline(); this.netStatus('Le serveur a redémarré : la partie ou le salon est perdu.');
          break;
        case 'chat': this.showChat(d); break;
        case 'desync': this.hud.toast('Désynchronisation détectée : resynchronisation…', 3000); break;
        case 'reject':
          if (d.reason === 'not-your-role') this.hud.toast('Cette compétence est celle de ton partenaire.', 2200);
          else if (d.reason === 'rate') this.hud.toast('Trop d\'ordres à la fois.', 1500);
          break;
        case 'error':
          if (d.code === 'version') { this.netStatus(d.msg); this.hud.toast(d.msg, 5000); }
          else if (this.kind === 'net') this.hud.toast(d.msg, 3000);
          else { this.netStatus(d.msg); if (d.code === 'room-not-found' || d.code === 'room-full') this.hud.toast(d.msg, 2500); }
          break;
      }
    };

    /* ---------------------------------- Salon ---------------------------------- */

    P.showLobby = function () {
      const net = this.net, r = net && net.room;
      if (!r) return this.showOnline();
      const me = r.you, host = r.host === me, coop = r.mode === 'coop';
      document.body.dataset.theme = 'desert';
      const rows = [0, 1].map((i) => {
        const p = r.players[i];
        const role = coop ? NET.COOP_ROLES[i].name : (i === 0 ? 'Armée turquoise' : 'Armée rouge');
        if (!p) return '<div class="prow empty"><span>En attente d\'un joueur…</span><span class="role">' + role + '</span></div>';
        const st = !p.connected ? '<b class="st off">hors ligne</b>' : p.ready ? '<b class="st ok">prêt</b>' : '<b class="st">pas prêt</b>';
        return '<div class="prow' + (i === me ? ' me' : '') + '"><span>' + esc(p.name) + (i === r.host ? ' <small>(hôte)</small>' : '') + (i === me ? ' <small>(toi)</small>' : '') + '</span><span class="role">' + role + '</span>' + st + '</div>';
      }).join('');
      const dis = host ? '' : ' disabled';
      let opts;
      if (coop) {
        const levels = NS.Campaign.all().map((l, i) => '<option value="' + i + '"' + (r.settings.level === i ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(l.name) + '</option>').join('');
        opts = '<label class="field">Niveau<select id="set-level"' + dis + '>' + levels + '</select></label>';
      } else {
        const th = Object.keys(THEMES).map((k) => '<option value="' + k + '"' + (r.settings.theme === k ? ' selected' : '') + '>' + THEMES[k] + '</option>').join('');
        const seg = [2, 3, 4, 5].map((k) => '<option value="' + k + '"' + (r.settings.segments === k ? ' selected' : '') + '>' + k + ' obstacles par moitié</option>').join('');
        opts = '<label class="field">Univers<select id="set-theme"' + dis + '>' + th + '</select></label><label class="field">Parcours<select id="set-seg"' + dis + '>' + seg + '</select></label>' +
          '<label class="field">Pièges cachés<select id="set-traps"' + dis + '>' + [0, 1, 2].map((k) => '<option value="' + k + '"' + (r.settings.traps === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>';
      }
      const link = /^https?:$/.test(location.protocol) ? location.origin + location.pathname + '?salon=' + r.code : '';
      this.openOverlay('<div class="card"><h2>' + (coop ? 'Salon coopératif' : 'Salon de duel') + '</h2>' +
        '<div class="roomcode" id="roomcode">' + r.code + '</div>' +
        '<p class="sub">Donne ce code à ton ' + (coop ? 'partenaire' : 'adversaire') + (link ? ' ou envoie-lui <a href="' + link + '">ce lien</a>' : '') + '.</p>' +
        '<div class="prows">' + rows + '</div>' + (coop ? '<p class="sub">Les compétences sont réparties : l\'Ingénieur construit et protège, le Démolisseur creuse et détruit. Si l\'un part, l\'autre reprend tout.</p>' : '') +
        '<div class="opts">' + opts + '</div><div id="lobby-count" class="count"></div>' + this.emojiRow() +
        '<div class="row"><button class="btn primary" data-action="net" data-arg="ready">' + (this.myReady() ? 'Pas prêt' : 'Prêt') + '</button><button class="btn" data-action="net" data-arg="leave">Quitter le salon</button></div></div>');
      const send = () => this.net.settings(coop ? { level: Number($('set-level').value) } : { theme: $('set-theme').value, segments: Number($('set-seg').value), traps: Number($('set-traps').value) });
      for (const id of ['set-level', 'set-theme', 'set-seg', 'set-traps']) if ($(id)) $(id).onchange = send;
      this.bindEmojiRow();
    };

    /* ----------------------------------- Chat ----------------------------------- */

    P.emojiRow = function () {
      return '<div class="emojis" id="emojis">' + Object.keys(NET.EMOJIS).map((k) => '<button class="btn emo" data-emo="' + k + '" aria-label="' + k + '">' + NET.EMOJIS[k] + '</button>').join('') + '</div>';
    };
    P.bindEmojiRow = function () {
      document.querySelectorAll('[data-emo]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); if (this.net) this.net.chat(b.dataset.emo); }; });
    };
    P.showChat = function (d) {
      const log = $('chatlog'), line = document.createElement('div');
      line.className = 'chatline' + (d.slot === (this.net && this.net.slot) ? ' mine' : '');
      line.innerHTML = '<b>' + esc(d.name) + '</b> ' + (NET.EMOJIS[d.code] || '');
      log.appendChild(line);
      while (log.children.length > 4) log.removeChild(log.firstChild);
      setTimeout(() => line.remove(), 4500);
      if (d.slot !== this.net.slot) this.audio.sfx('select');
    };

    /* ---------------------------------- En partie ---------------------------------- */

    P.startNet = function (msg) {
      const net = this.net;
      this.coopSolo = false;
      const me = net.config.mode === 'coop' ? 0 : net.slot;
      this.begin(net.def, 'net', net.sim, me);
      document.body.classList.add('net');
      this.showNetChrome();
      this.hud.setLevelName(net.def.name);
      if (net.config.mode === 'coop') {
        const role = NET.COOP_ROLES[net.slot], other = NET.COOP_ROLES[1 - net.slot];
        const first = NS.Skills.list.find((s) => role.skills.includes(s.id) && (net.sim.players[0].skills[s.id] | 0) > 0);
        this.skill = first ? first.id : null;
        this.hud.toast('Tu es l\'' + role.name + ' : ' + role.skills.map((s) => NS.Skills.byId[s].label).join(', ') + '. Ton partenaire, le ' + other.name + ', a le reste.', 7000);
      } else this.hud.toast(net.def.hint, 5000);
    };

    P.coopMask = function () {
      if (this.kind !== 'net' || !this.net.config || this.net.config.mode !== 'coop' || this.coopSolo) return null;
      const role = NET.COOP_ROLES[this.net.slot];
      return { skills: new Set(role.skills), weapons: new Set(role.weapons) };
    };
    P.barredSkill = function (id) { const m = this.coopMask(); return !!(m && !m.skills.has(id)); };
    P.barredWeapon = function (id) { const m = this.coopMask(); return !!(m && !m.weapons.has(id)); };

    P.netFrame = function (dt) {
      const net = this.net;
      net.advance(dt);
      if (net.sim && net.sim !== this.sim) {             // reconstruction (désynchronisation, reconnexion) : nouvel état, nouveau terrain
        this.sim = net.sim; this.renderer.setLevel(this.sim); this.fx.clear();
      }
      this.updateNetChrome();
    };

    P.netEndCheck = function (dt) {
      const net = this.net, sim = this.sim;
      if (this.overlayOpen || !sim) return;
      const over = net.ended || sim.status !== 'running';
      if (!over) { this.resultTimer = 0; return; }
      this.resultTimer += dt;
      if (this.resultTimer > (net.ended ? 1.4 : 4)) this.showNetResult();
    };

    P.showNetChrome = function () { $('btn-chat').hidden = false; $('netinfo').hidden = false; };
    P.hideNetChrome = function () { $('btn-chat').hidden = true; $('netinfo').hidden = true; $('netbadge').hidden = true; $('chatbar').hidden = true; };

    /** Bandeau d'état de la connexion et petit indicateur de latence. */
    P.updateNetChrome = function () {
      const net = this.net;
      if (!net || this.kind !== 'net') return;
      let msg = '';
      if (net.state !== 'open') msg = 'Connexion perdue, reconnexion…';
      else if (net.syncing) msg = 'Resynchronisation…';
      else if (net.peerDown) msg = (net.config.mode === 'coop' ? 'Partenaire' : 'Adversaire') + ' déconnecté, ' + Math.max(0, Math.ceil((net.peerDown.until - Date.now()) / 1000)) + ' s avant abandon';
      else if (net.sim && net.allowed - net.sim.tick > 25) msg = 'Retard réseau : rattrapage…';
      const b = $('netbadge');
      b.hidden = !msg;
      if (msg) b.textContent = msg;
      $('netinfo').textContent = Math.round(net.rtt) + ' ms · délai ' + Math.round(net.delay * 33) + ' ms';
    };

    /* ---------------------------------- Résultats ---------------------------------- */

    P.showNetResult = function () {
      const net = this.net, sim = this.sim, end = net.ended || {};
      this.kind = 'net-over';
      document.body.classList.remove('net');
      this.hideNetChrome();
      const names = (net.room && net.room.players || []).map((p) => (p ? esc(p.name) : '?'));
      const tm = (ticks) => { const s = Math.round(ticks / NS.C.TICK_RATE); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
      const by = (slot) => ({ skills: sim.log.filter((c) => c.by === slot && c.type === 'assign').length, weapons: sim.log.filter((c) => c.by === slot && c.type === 'weapon').length });
      const row = (l, a, b) => '<tr><td>' + l + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
      const why = { abandon: end.quit === net.slot ? 'Tu as abandonné.' : 'Abandon de l\'autre joueur.', desync: 'Partie annulée : désynchronisation répétée.', sim: '' }[end.reason] || '';
      let html;
      if (net.config.mode === 'coop') {
        const p = sim.players[0], ok = sim.status === 'won', pct = Math.round((p.saved * 100) / p.count);
        html = '<div class="card"><h2>' + (ok ? 'Mission réussie' : 'Mission ratée') + '</h2><div class="result-big ' + (ok ? 'win' : 'lose') + '">' + pct + '%</div><p>' + why + '</p>' +
          '<table class="stats"><tr><th></th><th>' + names[0] + '</th><th>' + names[1] + '</th></tr>' +
          row('Rôle', NET.COOP_ROLES[0].name, NET.COOP_ROLES[1].name) +
          row('Compétences données', by(0).skills, by(1).skills) + row('Armes tirées', by(0).weapons, by(1).weapons) + '</table>' +
          '<table class="stats"><tr><th>Armée commune</th><th></th></tr><tr><td>Bidules sauvés</td><td>' + p.saved + ' / ' + p.count + ' (objectif ' + p.goal + '%)</td></tr><tr><td>Bidules perdus</td><td>' + p.dead + '</td></tr>' +
          this.lossRows(p).map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '<tr><td>Points dépensés</td><td>' + p.stats.spent + '</td></tr><tr><td>Durée</td><td>' + tm(sim.tick) + '</td></tr></table>';
      } else {
        const me = sim.players[net.slot], op = sim.players[1 - net.slot];
        let result = sim.status === 'won' ? (net.slot === 0 ? 'win' : 'lose') : sim.status === 'lost' ? (net.slot === 1 ? 'win' : 'lose') : 'draw';
        if (end.reason === 'abandon' && end.winner >= 0) result = end.winner === net.slot ? 'win' : 'lose';
        if (end.reason === 'desync') result = 'draw';
        const title = { win: 'Victoire !', lose: 'Défaite', draw: 'Égalité' }[result];
        html = '<div class="card"><h2>' + title + '</h2><div class="result-big ' + (result === 'win' ? 'win' : 'lose') + '">' + me.saved + ' : ' + op.saved + '</div><p>' + why + '</p>' +
          '<table class="stats"><tr><th></th><th>' + names[net.slot] + '</th><th>' + names[1 - net.slot] + '</th></tr>' +
          row('Bidules sauvés', me.saved + ' / ' + me.count, op.saved + ' / ' + op.count) + row('Bidules perdus', me.dead, op.dead) +
          row('Adversaires éliminés', me.stats.kills, op.stats.kills) + row('Compétences données', me.stats.skills, op.stats.skills) +
          row('Armes tirées', me.stats.weapons, op.stats.weapons) + row('Points dépensés', me.stats.spent, op.stats.spent) +
          row('Durée', tm(sim.tick), '') + '</table>';
      }
      html += this.emojiRow() + '<div class="row"><button class="btn primary" data-action="net" data-arg="back">Retour au salon</button><button class="btn" data-action="net" data-arg="quit">Quitter</button></div></div>';
      this.openOverlay(html);
      this.bindEmojiRow();
      $('chatlog').style.zIndex = 20;
    };
  }

  NS.OnlineUI = { install };
})(typeof window !== 'undefined' ? window : globalThis);
