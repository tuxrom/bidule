/**
 * netclient.js
 * Session réseau côté client : connexion WebSocket avec reconnexion automatique, salons, et surtout le LOCKSTEP.
 * Aucune dépendance au DOM : le même code tourne dans le navigateur et sous Node (tests avec latence simulée).
 *
 * Principe : le client n'envoie que des commandes. Le serveur les date (pas d'exécution = pas courant + délai
 * d'entrée), les numérote et les rediffuse par lots (`step`). Chaque client exécute alors la même simulation, avance
 * au plus jusqu'au pas autorisé par le serveur (`allowed`) et lui envoie périodiquement une somme de contrôle.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const NET = NS.Net, STEP = 1 / NS.C.TICK_RATE;

  class NetSession {
    /**
     * @param {object} o {url, WebSocketImpl, name, storage, on(type, data), now()}
     */
    constructor(o) {
      this.url = o.url;
      this.WS = o.WebSocketImpl || G.WebSocket;
      this.name = o.name || 'Joueur';
      this.storage = o.storage || null;
      this.emit = o.on || (() => {});
      this.now = o.now || (() => Date.now());
      this.ws = null;
      this.state = 'closed';             // connecting | open | reconnecting | closed
      this.token = this.storage ? this.read('bidules.token') : null;
      this.attempt = 0;
      this.wantOpen = false;
      this.room = null;
      this.slot = -1;
      this.rtt = 100;
      this.samples = 0;
      this.reset();
    }

    read(k) { try { return this.storage.getItem(k); } catch (e) { return null; } }
    write(k, v) { try { if (v === null) this.storage.removeItem(k); else this.storage.setItem(k, v); } catch (e) { /* ignoré */ } }

    /** Remet à zéro tout ce qui concerne une partie. */
    reset() {
      this.sim = null; this.config = null; this.def = null;
      this.allowed = 0; this.lastTo = 0; this.acc = 0;
      this.delay = NET ? NET.DELAY_MIN : 3;
      this.syncing = false; this.syncTarget = 0;
      this.ended = null; this.peerDown = null;
      this.stats = { desyncs: 0, resyncs: 0, stalls: 0, lagMax: 0 };
      this.hashLog = new Map();           // pas -> somme de contrôle envoyée (diagnostic et tests)
    }

    /* ------------------------------ Connexion ------------------------------ */

    connect() {
      this.wantOpen = true;
      this.open();
    }

    open() {
      if (!this.wantOpen) return;
      this.state = this.attempt ? 'reconnecting' : 'connecting';
      this.emit('state', this.state);
      let ws;
      try { ws = new this.WS(this.url); } catch (e) { return this.scheduleReconnect(); }
      this.ws = ws;
      ws.onopen = () => {
        this.attempt = 0;
        this.state = 'open';
        this.sendRaw({ type: 'hello', protocol: NET.PROTOCOL, name: this.name, token: this.token });
        this.pingTimer = setInterval(() => this.ping(), this.samples < 5 ? 500 : 2000);   // mesures rapides au début
        this.ping();
        this.emit('state', 'open');
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch (e) { return; }
        this.onMessage(m);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        clearInterval(this.pingTimer);
        this.ws = null;
        if (this.wantOpen) this.scheduleReconnect(); else { this.state = 'closed'; this.emit('state', 'closed'); }
      };
      ws.onerror = () => {};
    }

    scheduleReconnect() {
      this.state = 'reconnecting';
      this.emit('state', 'reconnecting');
      const wait = Math.min(8000, 400 * Math.pow(2, this.attempt++));
      this.retryTimer = setTimeout(() => this.open(), wait);
    }

    close() {
      this.wantOpen = false;
      clearTimeout(this.retryTimer); clearInterval(this.pingTimer);
      if (this.ws) { try { this.ws.close(); } catch (e) { /* fermé */ } }
    }

    sendRaw(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
    ping() { this.sendRaw({ type: 'ping', t: this.now(), rtt: Math.round(this.rtt) }); }

    /* ------------------------------- Messages ------------------------------- */

    onMessage(m) {
      switch (m.type) {
        case 'welcome':
          this.token = m.token; if (this.storage) this.write('bidules.token', m.token);
          if ((this.room || this.sim) && !m.inRoom) { this.room = null; this.reset(); this.emit('lost', {}); }   // le serveur a redémarré : le salon n'existe plus
          this.emit('welcome', m);
          break;
        case 'pong': {
          const sample = this.now() - m.t;
          this.rtt = this.samples++ ? this.rtt * 0.7 + sample * 0.3 : sample;      // la première mesure remplace la valeur par défaut
          this.emit('rtt', this.rtt);
          break;
        }
        case 'room': this.room = m; if (m.you !== undefined && m.you >= 0) this.slot = m.you; this.emit('room', m); break;
        case 'countdown': this.emit('countdown', m); break;
        case 'start': this.onStart(m); break;
        case 'step': this.onStep(m); break;
        case 'resync': this.onResync(m); break;
        case 'desync': this.stats.desyncs++; this.emit('desync', m); break;
        case 'peer':
          this.peerDown = m.status === 'disconnected' ? { slot: m.slot, until: this.now() + m.graceMs } : null;
          this.emit('peer', m);
          break;
        case 'end': this.ended = m; this.emit('end', m); break;
        case 'chat': this.emit('chat', m); break;
        case 'reject': this.emit('reject', m); break;
        case 'error': this.emit('error', m); break;
      }
    }

    /** Début de partie : on construit la même simulation que le serveur. */
    onStart(m) {
      this.reset();
      this.config = m.config; this.slot = m.slot; this.delay = m.delay;
      this.def = NET.buildDef(m.config);
      this.sim = new NS.Simulation(this.def);
      this.emit('start', m);
    }

    onStep(m) {
      if (!this.sim) return;
      if (m.from !== this.lastTo) { this.requestResync(); return; }   // un trou dans la suite des lots : on se reconstruit
      for (const c of m.cmds) this.sim.queue.push(Object.assign({}, c));
      this.lastTo = m.to; this.allowed = m.to; this.delay = m.delay;
    }

    requestResync() {
      if (this.syncing || this.resyncAsked && this.now() - this.resyncAsked < 1500) return;
      this.resyncAsked = this.now();
      this.sendRaw({ type: 'resync' });
    }

    /** Reconstruction complète depuis le journal du serveur (désynchronisation, reconnexion, trou de lots). */
    onResync(m) {
      this.stats.resyncs++;
      this.config = m.config; this.slot = m.slot; this.delay = m.delay;
      this.def = NET.buildDef(m.config);
      this.sim = new NS.Simulation(this.def);
      for (const c of m.log) this.sim.queue.push(Object.assign({}, c));
      this.lastTo = m.to; this.allowed = m.to; this.syncTarget = m.to;
      this.syncing = true; this.acc = 0;
      this.emit('resync', m);
      this.syncSlice();
    }

    /** Rejoue le journal par tranches (jamais plus de 500 pas d'un coup : l'écran reste fluide). */
    syncSlice() {
      let n = 0;
      while (this.sim.tick < this.syncTarget && n++ < 500) this.sim.step();
      if (this.sim.tick >= this.syncTarget) { this.syncing = false; this.emit('synced', { tick: this.sim.tick }); }
    }

    /* ------------------------------- Avancement ------------------------------- */

    /**
     * Fait avancer la simulation locale de `dt` secondes de temps réel, sans jamais dépasser le pas autorisé par
     * le serveur. Si le client a pris du retard (réseau, onglet en arrière-plan), il accélère pour le rattraper.
     * @returns {number} pas exécutés
     */
    advance(dt) {
      if (!this.sim) return 0;
      if (this.syncing) { this.syncSlice(); return 0; }
      const lag = this.allowed - this.sim.tick;
      if (lag > this.stats.lagMax) this.stats.lagMax = lag;
      this.acc += dt * (lag > 40 ? 4 : lag > 20 ? 2 : lag > 9 ? 1.4 : 1);
      let n = 0;
      while (this.acc >= STEP && this.sim.tick < this.allowed && n < 10 && this.sim.status === 'running') {
        this.sim.step();
        this.acc -= STEP;
        n++;
        if (this.sim.tick % NET.HASH_EVERY === 0) {
          const h = this.sim.hash();
          this.hashLog.set(this.sim.tick, h);
          if (this.hashLog.size > 200) this.hashLog.delete(this.hashLog.keys().next().value);
          this.sendRaw({ type: 'hash', tick: this.sim.tick, h });
        }
      }
      if (this.sim.tick >= this.allowed) { this.acc = Math.min(this.acc, STEP); if (n === 0 && this.sim.status === 'running') this.stats.stalls++; }
      return n;
    }

    /* -------------------------------- Actions -------------------------------- */

    create(mode) { this.sendRaw({ type: 'create', mode }); }
    join(code) { this.sendRaw({ type: 'join', code: String(code).toUpperCase() }); }
    leave() { this.sendRaw({ type: 'leave' }); this.room = null; this.reset(); }
    ready(v) { this.sendRaw({ type: 'ready', ready: !!v }); }
    settings(s) { this.sendRaw({ type: 'settings', settings: s }); }
    resign() { this.sendRaw({ type: 'resign' }); }
    chat(code) { this.sendRaw({ type: 'chat', code }); }
    /** Le client propose, le serveur date et dispose : `cmd` n'a ni `tick` ni `player`. */
    sendCommand(cmd) { this.sendRaw({ type: 'cmd', c: cmd }); }
    /** Pour les tests : abîme l'état local pour provoquer une désynchronisation. */
    debugCorrupt() { if (this.sim) { this.sim.terrain.data[1000] = (this.sim.terrain.data[1000] + 1) % 4; } }
  }

  /**
   * Enrobage de WebSocket qui retarde chaque message de `lat` ms (+ gigue), ordre conservé. Activé par `?lag=120`
   * dans l'adresse de la page, pour éprouver le lockstep sans outil externe.
   */
  NetSession.lagSocket = function (lat, jit) {
    return class LagSocket {
      constructor(url) {
        this.ws = new G.WebSocket(url);
        this.t = { in: 0, out: 0 };
        const defer = (k, fn) => { const at = Math.max(this.t[k], Date.now() + lat + Math.random() * jit); this.t[k] = at; setTimeout(fn, Math.max(0, at - Date.now())); };
        this.defer = defer;
        this.ws.onopen = () => defer('in', () => this.onopen && this.onopen());
        this.ws.onmessage = (e) => defer('in', () => this.onmessage && this.onmessage({ data: e.data }));
        this.ws.onclose = () => defer('in', () => this.onclose && this.onclose());
        this.ws.onerror = () => {};
      }
      get readyState() { return this.ws.readyState; }
      send(s) { this.defer('out', () => { if (this.ws.readyState === 1) this.ws.send(s); }); }
      close() { this.ws.close(); }
    };
  };

  NS.NetSession = NetSession;
})(typeof window !== 'undefined' ? window : globalThis);
