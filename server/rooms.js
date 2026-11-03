/**
 * rooms.js
 * Salons et parties en ligne. Le serveur fait AUTORITÉ de trois façons :
 *
 *  1. il possède l'horloge : une seule horloge de partie (30 pas par seconde), qui n'attend jamais le client le plus lent ;
 *  2. il numérote et date les commandes : un client propose un ordre, le serveur lui donne un pas d'exécution
 *     (pas courant + délai d'entrée adaptatif), un propriétaire (`player`) et un ordre global, puis le diffuse ;
 *  3. il exécute lui-même la simulation (le même code que les clients) : sa somme de contrôle est la référence,
 *     et son journal de commandes sert à resynchroniser un client ou à le reconnecter.
 *
 * C'est un lockstep déterministe : on n'échange que des commandes, jamais d'état. Voir docs/PROTOCOLE.md.
 */
const crypto = require('crypto');
const NS = require('./engine')();
const NET = NS.Net;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';        // sans I ni O mêlés à 1 et 0
const COUNTDOWN_MS = 3000;
const GRACE_MS = Number(process.env.NET_GRACE_MS || 30000);   // attente d'un joueur déconnecté
const timeScale = () => Number(process.env.NET_TIME_SCALE || 1);   // 1 en production ; plus en test pour finir une partie vite
const PAUSE_BUDGET_MS = 90000;                          // total de pauses subies par un joueur et par partie
const LOBBY_IDLE_MS = 30 * 60 * 1000;
const MAX_ROOMS = 2000;
const MAX_DESYNCS = 3;
const NAME_MAX = 16;

const now = () => Date.now();
const send = (c, obj) => { if (c && c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(obj)); };

class Room {
  constructor(mgr, code, mode) {
    this.mgr = mgr;
    this.code = code;
    this.mode = mode;                                  // 'vs' | 'coop'
    this.settings = NET.defaultSettings(mode);
    this.slots = [null, null];                         // Client | null
    this.hostSlot = 0;
    this.state = 'lobby';                              // lobby | countdown | playing
    this.game = null;
    this.timer = null;
    this.lastActivity = now();
  }

  get clients() { return this.slots.filter(Boolean); }
  slotOf(c) { return this.slots.indexOf(c); }
  broadcast(obj, except) { for (const c of this.clients) if (c !== except) send(c, obj); }

  /** État public du salon (écran de salon : joueurs, prêts, réglages). */
  info() {
    return {
      type: 'room', code: this.code, mode: this.mode, settings: this.settings, host: this.hostSlot, state: this.state,
      players: this.slots.map((c, i) => c && { slot: i, name: c.name, ready: c.ready, connected: c.connected }),
      delay: this.game ? this.game.delay : null
    };
  }
  pushInfo() { this.broadcast(this.info()); }

  /* ------------------------------- Salon ------------------------------- */

  join(c) {
    const free = this.slots.indexOf(null);
    if (free < 0) return false;
    this.slots[free] = c;
    c.room = this; c.slot = free; c.ready = false; c.desyncs = 0; c.pauseUsed = 0;
    if (this.slots.filter(Boolean).length === 1) this.hostSlot = free;
    this.lastActivity = now();
    this.pushInfo();
    return true;
  }

  /** Un joueur quitte le salon (ou la partie : en duel il abandonne, en coop son partenaire continue seul). */
  leave(c, why) {
    const slot = this.slotOf(c);
    if (slot < 0) return;
    if (this.state === 'playing') {
      if (this.mode === 'vs') this.endGame('abandon', 1 - slot, { quit: slot });
      else this.dropFromCoop(c);
    }
    if (this.slots[slot] !== c) return;                // endGame a déjà purgé ce joueur
    clearTimeout(c.graceTimer);
    this.slots[slot] = null;
    c.room = null; c.slot = -1; c.ready = false;
    if (this.state === 'countdown') this.cancelCountdown();
    if (!this.clients.length) return this.mgr.removeRoom(this);
    if (this.hostSlot === slot) this.hostSlot = this.slots.findIndex(Boolean);
    if (this.state === 'playing' && this.clients.every((x) => x.connected)) this.resume();
    if (this.state !== 'playing') for (const o of this.clients) o.ready = false;
    this.pushInfo();
  }

  setSettings(c, raw) {
    if (this.slotOf(c) !== this.hostSlot || this.state !== 'lobby') return 'not-host';
    this.settings = NET.sanitizeSettings(this.mode, raw);
    for (const o of this.clients) o.ready = false;
    this.pushInfo();
    return null;
  }

  setReady(c, ready) {
    if (this.state !== 'lobby') return;
    c.ready = !!ready;
    this.pushInfo();
    if (this.slots.every((s) => s && s.ready && s.connected)) this.startCountdown();
  }

  startCountdown() {
    this.state = 'countdown';
    this.pushInfo();
    let n = Math.round(COUNTDOWN_MS / 1000);
    const tick = () => {
      this.broadcast({ type: 'countdown', n });
      if (n-- <= 0) return this.startGame();
      this.timer = setTimeout(tick, 1000);
    };
    tick();
  }

  cancelCountdown() { clearTimeout(this.timer); this.state = 'lobby'; }

  /* ------------------------------- Partie ------------------------------- */

  startGame() {
    const config = Object.assign({ protocol: NET.PROTOCOL, mode: this.mode, seed: crypto.randomInt(1, 1e6) }, this.settings);
    const sim = new NS.Simulation(NET.buildDef(config));
    const rtt = Math.max(...this.clients.map((c) => c.rtt));
    this.game = {
      config, sim, log: [], future: [], lastSent: 0, hashes: new Map(), over: false,
      delay: NET.adaptiveDelay(rtt * timeScale(), Math.max(...this.clients.map((c) => c.jitter)) * timeScale()),
      t0: now() + 300, pausedMs: 0, pausedAt: 0, paused: false, lastDelayUpdate: now()
    };
    this.state = 'playing';
    for (const c of this.clients) { c.desyncs = 0; c.cmdTimes = []; }
    for (const c of this.clients) send(c, { type: 'start', config, slot: this.slotOf(c), delay: this.game.delay });
    this.pushInfo();
    this.timer = setInterval(() => this.pump(), 8);
  }

  /** Avance l'horloge de partie : jamais plus vite que le temps réel, et jamais suspendue par un client lent. */
  pump() {
    const g = this.game;
    if (!g || g.over || g.paused) return;
    const due = Math.floor(((now() - g.t0 - g.pausedMs) * NS.C.TICK_RATE * timeScale()) / 1000);
    let n = 0;
    while (g.sim.tick < due && n++ < 12 && !g.over) this.tickOnce();
    if (now() - g.lastDelayUpdate > 2000) this.updateDelay();
  }

  tickOnce() {
    const g = this.game, sim = g.sim;
    sim.step();
    if (sim.tick % NET.HASH_EVERY === 0) {
      g.hashes.set(sim.tick, sim.hash());
      if (g.hashes.size > 120) g.hashes.delete(g.hashes.keys().next().value);
    }
    const finished = sim.status !== 'running';
    if (sim.tick % NET.TURN === 0 || finished) this.flushTurn();
    if (finished) this.endGame('sim', sim.status === 'won' ? 0 : sim.status === 'lost' ? 1 : -1);
  }

  /** Envoie aux clients les commandes dont le pas d'exécution est maintenant passé, et l'autorisation d'avancer. */
  flushTurn() {
    const g = this.game;
    const deliver = g.future.filter((c) => c.tick < g.sim.tick);
    g.future = g.future.filter((c) => c.tick >= g.sim.tick);
    g.log.push(...deliver);
    this.broadcast({ type: 'step', from: g.lastSent, to: g.sim.tick, cmds: deliver, delay: g.delay });
    g.lastSent = g.sim.tick;
  }

  /** Délai d'entrée adaptatif : suit la latence du pire joueur, monte vite, redescend lentement. */
  updateDelay() {
    const g = this.game;
    g.lastDelayUpdate = now();
    const k = timeScale();                              // en test accéléré, une milliseconde réelle vaut k millisecondes de jeu
    const want = NET.adaptiveDelay(Math.max(...this.clients.map((c) => c.rtt)) * k, Math.max(...this.clients.map((c) => c.jitter)) * k);
    if (want > g.delay) g.delay = want;
    else if (want < g.delay - 1) g.delay -= 1;
  }

  /** Commande d'un joueur pendant la partie. */
  onCommand(c, raw) {
    const g = this.game;
    if (this.state !== 'playing' || !g || g.over) return send(c, { type: 'reject', reason: 'bad-state' });
    if (g.paused) return send(c, { type: 'reject', reason: 'paused' });
    const t = now();
    c.cmdTimes = c.cmdTimes.filter((x) => t - x < 1000);
    if (c.cmdTimes.length >= 25) return send(c, { type: 'reject', reason: 'rate' });
    c.cmdTimes.push(t);
    const cmd = NET.sanitizeCommand(raw);
    if (!cmd) return send(c, { type: 'reject', reason: 'bad-command' });
    const slot = this.slotOf(c), partner = this.mode === 'coop' && this.slots[1 - slot] && this.slots[1 - slot].inGame !== false;
    if (!NET.allowed(cmd, this.mode, slot, partner)) return send(c, { type: 'reject', reason: 'not-your-role' });
    const full = Object.assign({ tick: g.sim.tick + g.delay, player: this.mode === 'coop' ? 0 : slot, by: slot }, cmd);
    g.future.push(full);
    g.sim.queue.push(Object.assign({}, full));         // le serveur exécute la même commande, au même pas
  }

  /** Somme de contrôle d'un client : comparée à celle du serveur, qui fait référence. */
  onHash(c, msg) {
    const g = this.game;
    if (!g || g.over || !Number.isInteger(msg.tick)) return;
    const ref = g.hashes.get(msg.tick);
    if (ref === undefined || ref === msg.h) return;
    c.desyncs++;
    console.warn(`[${this.code}] désynchronisation du joueur ${this.slotOf(c)} au pas ${msg.tick} (${msg.h} au lieu de ${ref}), n°${c.desyncs}`);
    if (c.desyncs >= MAX_DESYNCS) return this.endGame('desync', -1);
    send(c, { type: 'desync', tick: msg.tick, expected: ref });
    this.sendResync(c);
  }

  /** Reconstruction complète d'un client : configuration + journal des commandes déjà diffusées. */
  sendResync(c) {
    const g = this.game;
    send(c, { type: 'resync', config: g.config, slot: this.slotOf(c), log: g.log, to: g.lastSent, delay: g.delay, over: g.over });
  }

  /* ----------------------------- Déconnexions ----------------------------- */

  /** Perte de connexion pendant la partie : pause, puis abandon si le joueur ne revient pas. */
  onDisconnect(c) {
    c.connected = false;
    c.ws = null;
    if (this.state === 'lobby') return this.leave(c, 'disconnect');
    if (this.state === 'countdown') return this.leave(c, 'disconnect');
    const g = this.game;
    if (!g || g.over) return;
    const slot = this.slotOf(c);
    if (!g.paused) { g.paused = true; g.pausedAt = now(); }
    c.dropAt = now();
    const left = Math.max(0, PAUSE_BUDGET_MS - c.pauseUsed);
    const grace = Math.min(GRACE_MS, left);
    this.broadcast({ type: 'peer', slot, status: 'disconnected', graceMs: grace });
    this.pushInfo();
    clearTimeout(c.graceTimer);
    c.graceTimer = setTimeout(() => this.forfeit(c), grace);
  }

  /** Un joueur revient avec son jeton : on le resynchronise et la partie reprend si tout le monde est là. */
  onReconnect(c, ws) {
    clearTimeout(c.graceTimer);
    c.ws = ws; c.connected = true;
    if (this.state === 'playing' && this.game) {
      c.pauseUsed += now() - (c.dropAt || now());
      send(c, { type: 'room', ...this.info() });
      this.sendResync(c);
      this.broadcast({ type: 'peer', slot: this.slotOf(c), status: 'reconnected' }, c);
      if (this.clients.every((x) => x.connected)) this.resume();
    } else {
      send(c, this.info());
    }
  }

  resume() {
    const g = this.game;
    if (g && g.paused) { g.pausedMs += now() - g.pausedAt; g.paused = false; }
  }

  forfeit(c) {
    if (this.state !== 'playing') return;
    this.leave(c, 'forfeit');                           // duel : défaite par abandon ; coop : le partenaire continue seul
  }

  /** En coop, le partenaire qui s'en va laisse à l'autre tous les rôles. */
  dropFromCoop(c) {
    if (c.inGame === false) return;
    c.inGame = false;
    this.broadcast({ type: 'peer', slot: this.slotOf(c), status: 'left' }, c);
    if (this.clients.filter((x) => x !== c && x.connected).length === 0) this.endGame('abandon', -1);
  }

  endGame(reason, winner, extra) {
    const g = this.game;
    if (!g || g.over) return;
    g.over = true;
    clearInterval(this.timer);
    const sim = g.sim;
    const msg = Object.assign({
      type: 'end', reason, winner, status: sim.status, tick: sim.tick, hash: sim.hash(),
      saved: sim.players.map((p) => p.saved), dead: sim.players.map((p) => p.dead)
    }, extra);
    this.broadcast(msg);
    this.state = 'lobby';
    for (const c of this.clients) { c.ready = false; c.inGame = undefined; clearTimeout(c.graceTimer); }
    for (let i = 0; i < 2; i++) if (this.slots[i] && !this.slots[i].connected) { this.slots[i].room = null; this.slots[i] = null; }
    if (!this.clients.length) return this.mgr.removeRoom(this);
    if (!this.slots[this.hostSlot]) this.hostSlot = this.slots.findIndex(Boolean);
    this.pushInfo();
  }

  destroy() { clearTimeout(this.timer); clearInterval(this.timer); for (const c of this.clients) clearTimeout(c.graceTimer); }
}

/* --------------------------------- Gestionnaire --------------------------------- */

class Manager {
  constructor() {
    this.rooms = new Map();
    this.clients = new Map();                           // jeton -> Client
    setInterval(() => this.sweep(), 60000).unref();
  }

  newCode() {
    for (let i = 0; i < 100; i++) {
      let code = '';
      for (let k = 0; k < 4; k++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  removeRoom(room) { room.destroy(); this.rooms.delete(room.code); }

  /** Salons inactifs et clients orphelins. */
  sweep() {
    const t = now();
    for (const room of [...this.rooms.values()]) if (room.state === 'lobby' && t - room.lastActivity > LOBBY_IDLE_MS) { room.broadcast({ type: 'error', code: 'idle', msg: 'Salon fermé pour inactivité.' }); this.removeRoom(room); }
    for (const [tok, c] of this.clients) if (!c.ws && !c.room && t - c.lastSeen > 60000) this.clients.delete(tok);
  }

  stats() { return { rooms: this.rooms.size, clients: this.clients.size, playing: [...this.rooms.values()].filter((r) => r.state === 'playing').length }; }

  /** Nouvelle connexion WebSocket. */
  attach(ws) {
    let c = null;
    const fail = (code, msg) => send({ ws }, { type: 'error', code, msg });
    const bucket = { n: 0, t: now() };
    ws.on('message', (data) => {
      const t = now();
      if (t - bucket.t > 1000) { bucket.t = t; bucket.n = 0; }
      if (++bucket.n > 80) return fail('rate', 'Trop de messages.');
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return fail('bad-message', 'JSON invalide.'); }
      if (!msg || typeof msg.type !== 'string') return fail('bad-message', 'Message invalide.');
      if (!c) {
        if (msg.type !== 'hello') return fail('bad-message', 'hello attendu.');
        c = this.hello(ws, msg);
        return;
      }
      c.lastSeen = t;
      try { this.dispatch(c, msg); } catch (e) { console.error('erreur de message', msg.type, e); fail('server', 'Erreur interne.'); }
    });
    ws.on('close', () => { if (c && c.ws === ws) this.onClose(c); });
    ws.on('error', () => {});
  }

  hello(ws, msg) {
    if (msg.protocol !== NET.PROTOCOL) { send({ ws }, { type: 'error', code: 'version', msg: 'Version du jeu incompatible : rechargez la page.' }); ws.close(); return null; }
    let c = typeof msg.token === 'string' ? this.clients.get(msg.token) : null;
    if (c) {                                            // reconnexion : on rattache le nouveau socket au même joueur
      if (c.ws && c.ws !== ws) { try { c.ws.close(); } catch (e) { /* déjà fermé */ } }
      c.lastSeen = now();
      c.name = this.cleanName(msg.name) || c.name;
      if (c.room) { c.room.onReconnect(c, ws); } else { c.ws = ws; c.connected = true; }
    } else {
      c = { token: crypto.randomBytes(16).toString('hex'), name: this.cleanName(msg.name) || 'Joueur', ws, connected: true, room: null, slot: -1, ready: false, rtt: 100, jitter: 10, rttSamples: 0, lastSeen: now(), desyncs: 0, pauseUsed: 0, cmdTimes: [] };
      this.clients.set(c.token, c);
    }
    send(c, { type: 'welcome', token: c.token, protocol: NET.PROTOCOL, build: NET.BUILD, serverTime: now(), inRoom: c.room ? c.room.code : null });
    return c;
  }

  cleanName(n) { return typeof n === 'string' ? n.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, NAME_MAX) : ''; }

  onClose(c) {
    c.ws = null; c.connected = false; c.lastSeen = now();
    if (c.room) c.room.onDisconnect(c);
  }

  dispatch(c, msg) {
    const room = c.room;
    const err = (code, text) => send(c, { type: 'error', code, msg: text });
    switch (msg.type) {
      case 'ping': {                                    // le client mesure son RTT et nous le rapporte
        if (Number.isFinite(msg.rtt) && msg.rtt >= 0 && msg.rtt < 10000) {
          if (!c.rttSamples++) { c.rtt = msg.rtt; c.jitter = 0; }               // première mesure : on adopte la valeur du client
          else { c.jitter = c.jitter * 0.8 + Math.abs(msg.rtt - c.rtt) * 0.2; c.rtt = c.rtt * 0.7 + msg.rtt * 0.3; }
        }
        return send(c, { type: 'pong', t: msg.t, tick: room && room.game ? room.game.sim.tick : 0 });
      }
      case 'create': {
        if (room) return err('bad-state', 'Déjà dans un salon.');
        if (this.rooms.size >= MAX_ROOMS) return err('full', 'Serveur plein.');
        const mode = msg.mode === 'coop' ? 'coop' : 'vs';
        const code = this.newCode();
        const r = new Room(this, code, mode);
        this.rooms.set(code, r);
        r.join(c);
        return;
      }
      case 'join': {
        if (room) return err('bad-state', 'Déjà dans un salon.');
        const r = this.rooms.get(String(msg.code || '').toUpperCase());
        if (!r) return err('room-not-found', 'Salon introuvable.');
        if (r.state !== 'lobby') return err('bad-state', 'Partie déjà commencée.');
        if (!r.join(c)) return err('room-full', 'Salon complet.');
        return;
      }
      case 'leave': return room ? room.leave(c, 'leave') : undefined;
      case 'resign': return room && room.state === 'playing' ? room.leave(c, 'resign') : undefined;
      case 'settings': return room ? (e => e && err(e, 'Réservé à l\'hôte.'))(room.setSettings(c, msg.settings)) : undefined;
      case 'ready': return room ? room.setReady(c, msg.ready) : undefined;
      case 'cmd': return room ? room.onCommand(c, msg.c) : undefined;
      case 'hash': return room ? room.onHash(c, msg) : undefined;
      case 'resync': return room && room.state === 'playing' ? room.sendResync(c) : undefined;
      case 'chat': {
        if (!room || !NET.EMOJIS[msg.code]) return;
        const t = now();
        if (t - (c.lastChat || 0) < 800) return;
        c.lastChat = t;
        return room.broadcast({ type: 'chat', slot: room.slotOf(c), name: c.name, code: msg.code });
      }
      default: return err('bad-message', 'Type inconnu : ' + msg.type);
    }
  }
}

module.exports = { Manager, Room, GRACE_MS, PAUSE_BUDGET_MS };
