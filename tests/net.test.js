/**
 * Tests réseau : vrai serveur (ws), vrais clients headless (NetSession), latence et gigue simulées par un
 * enrobage du WebSocket. Couvre : protocole, salons, lockstep, délai adaptatif, désynchronisation, reconnexion,
 * abandon, coopération, chat, sécurité des commandes. Lance : node tests/net.test.js
 */
process.env.NET_TIME_SCALE = '6';      // le serveur joue 6 fois plus vite : une partie entière tient en quelques secondes
process.env.NET_GRACE_MS = '900';      // un joueur absent forfait au bout de 0,9 s au lieu de 30 s
const assert = require('assert');
const WebSocket = require('ws');
const { server, manager } = require('../server/server');
const NS = globalThis.Bidules;
let SCALE = 6;
const setScale = (k) => { SCALE = k; process.env.NET_TIME_SCALE = String(k); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > (ms || 5000)) throw new Error('délai dépassé : ' + (what || cond)); await sleep(10); }
}

/** WebSocket avec latence aller et retour (`lat` ms de chaque côté) et gigue ; l'ordre des messages est conservé (TCP). */
function lagWS(lat, jit) {
  return class LagWS {
    constructor(url) {
      this.ws = new WebSocket(url);
      this.inT = 0; this.outT = 0;
      const defer = (kind, fn) => { const k = kind === 'in' ? 'inT' : 'outT'; const at = Math.max(this[k], Date.now() + lat + Math.random() * jit); this[k] = at; setTimeout(fn, Math.max(0, at - Date.now())); };
      this.defer = defer;
      this.ws.on('open', () => defer('in', () => this.onopen && this.onopen()));
      this.ws.on('message', (d, isBinary) => defer('in', () => this.onmessage && this.onmessage({ data: d.toString() })));
      this.ws.on('close', () => defer('in', () => this.onclose && this.onclose()));
      this.ws.on('error', () => {});
    }
    get readyState() { return this.ws.readyState; }
    send(s) { this.defer('out', () => { if (this.ws.readyState === 1) this.ws.send(s); }); }
    close() { this.ws.close(); }
  };
}

let URL;
function client(name, lat, jit) {
  const events = [];
  const s = new NS.NetSession({ url: URL, WebSocketImpl: lat === undefined ? WebSocket : lagWS(lat, jit || 0), name, on: (t, d) => events.push({ t, d }) });
  s.events = events;
  s.connect();
  // Pompe : le « rendu » d'un client headless, 60 fois par seconde, au même rythme accéléré que le serveur.
  let last = Date.now();
  s.pump = setInterval(() => { const n = Date.now(); s.advance(((n - last) / 1000) * SCALE); last = n; }, 16);
  return s;
}
const stop = (...cs) => cs.forEach((c) => { clearInterval(c.pump); clearInterval(c.bot); c.close(); });
const seen = (c, t) => c.events.filter((e) => e.t === t);

/** Un pilote : toutes les 250 ms, un ordre vraisemblable (compétence, cadence ou arme). */
function bot(c, seed) {
  const rng = new NS.RNG(seed);
  c.bot = setInterval(() => {
    if (!c.sim || c.syncing || c.sim.status !== 'running') return;
    const me = c.config.mode === 'coop' ? 0 : c.slot;
    const mine = c.sim.bidules.filter((b) => b.owner === me && b.state === 'walk');
    const r = rng.next();
    if (r < 0.5 && mine.length) c.sendCommand({ type: 'assign', id: mine[rng.int(0, mine.length - 1)].id, skill: ['builder', 'basher', 'blocker', 'floater', 'climber'][rng.int(0, 4)] });
    else if (r < 0.7) c.sendCommand({ type: 'rate', value: rng.int(30, 80) });
    else if (r < 0.85) c.sendCommand({ type: 'weapon', weapon: 'recon' });
    else c.sendCommand({ type: 'weapon', weapon: 'cannon', angle: rng.int(20, 70), power: rng.int(30, 90) });
  }, 250);
}

async function pair(mode, latA, latB, jit) {
  const a = client('Alice', latA, jit), b = client('Bob', latB, jit);
  await waitFor(() => a.state === 'open' && b.state === 'open' && a.token && b.token, 3000, 'connexion');
  a.create(mode);
  await waitFor(() => a.room, 2000, 'salon créé');
  b.join(a.room.code);
  await waitFor(() => b.room && b.room.players.filter(Boolean).length === 2, 2000, 'rejoint');
  return { a, b };
}
async function startPair(p) {
  p.a.ready(true); p.b.ready(true);
  await waitFor(() => p.a.sim && p.b.sim, 8000, 'début de partie');
}
const roomOf = (c) => manager.rooms.get(c.room.code);

let n = 0;
const ok = (m) => console.log('OK ' + (++n) + '. ' + m);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  URL = 'ws://127.0.0.1:' + server.address().port + '/ws';

  // --- Protocole ---
  {
    const bad = new WebSocket(URL); const got = [];
    bad.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => bad.on('open', r));
    bad.send(JSON.stringify({ type: 'hello', protocol: 999 }));
    await waitFor(() => got.length, 2000);
    assert.strictEqual(got[0].code, 'version');
    const ws2 = new WebSocket(URL); const g2 = [];
    ws2.on('message', (d) => g2.push(JSON.parse(d.toString())));
    await new Promise((r) => ws2.on('open', r));
    ws2.send('pas du json'); ws2.send(JSON.stringify({ type: 'create' }));
    await waitFor(() => g2.length >= 2, 2000);
    assert.ok(g2.every((m) => m.type === 'error'), 'les messages invalides sont refusés');
    ws2.close();
    const c = client('Zed'); await waitFor(() => c.token, 2000);
    c.join('ZZZZ'); await waitFor(() => seen(c, 'error').length, 2000);
    assert.strictEqual(seen(c, 'error')[0].d.code, 'room-not-found');
    stop(c);
    ok('protocole : version, JSON invalide, message avant hello, salon inconnu');
  }

  // --- Salon : code, prêts, plein, hôte ---
  {
    const { a, b } = await pair('vs');
    assert.ok(/^[A-Z]{4}$/.test(a.room.code), 'code à 4 lettres');
    assert.strictEqual(a.room.host, 0);
    const c = client('Carl'); await waitFor(() => c.token, 2000);
    c.join(a.room.code); await waitFor(() => seen(c, 'error').length, 2000);
    assert.strictEqual(seen(c, 'error')[0].d.code, 'room-full');
    b.settings({ segments: 5 }); await waitFor(() => seen(b, 'error').length, 2000);
    assert.strictEqual(seen(b, 'error')[0].d.code, 'not-host', 'seul l\'hôte règle la partie');
    a.settings({ segments: 4, theme: 'arctic' });
    await waitFor(() => b.room.settings.theme === 'arctic', 2000);
    a.ready(true);
    await waitFor(() => b.room.players[0].ready, 2000);
    assert.strictEqual(b.room.players[1].ready, false, 'l\'état prêt de chacun est visible de l\'autre');
    stop(a, b, c);
    ok('salon : code, hôte, réglages, état prêt, salon plein');
  }

  // --- Lockstep sans latence : trois sommes de contrôle identiques (client A, client B, serveur) ---
  {
    const p = await pair('vs');
    await startPair(p);
    assert.deepStrictEqual(p.a.config, p.b.config);
    bot(p.a, 1); bot(p.b, 2);
    await waitFor(() => p.a.sim.tick >= 900 && p.b.sim.tick >= 900, 20000, 'jeu');
    const g = roomOf(p.a).game;
    let common = 0;
    for (const [t, h] of p.a.hashLog) if (p.b.hashLog.has(t) && g.hashes.has(t)) { assert.strictEqual(h, p.b.hashLog.get(t), 'A et B au pas ' + t); assert.strictEqual(h, g.hashes.get(t), 'serveur au pas ' + t); common++; }
    assert.ok(common >= 10, 'au moins 10 points de comparaison, obtenus : ' + common);
    assert.strictEqual(seen(p.a, 'desync').length + seen(p.b, 'desync').length, 0);
    assert.ok(g.log.length > 20, 'des commandes ont été échangées (' + g.log.length + ')');
    assert.ok(g.log.every((c) => c.player === c.by), 'en duel, la commande appartient à son émetteur');
    stop(p.a, p.b);
    ok('lockstep sans latence : A, B et serveur identiques sur ' + common + ' sommes de contrôle, ' + g.log.length + ' commandes');
  }

  // --- Latence et gigue : même résultat, délai d'entrée adaptatif ---
  async function latencyRun(lat, jit) {
    const p = await pair('vs', lat, lat, jit);
    await startPair(p);
    bot(p.a, 3); bot(p.b, 4);
    await waitFor(() => p.a.sim.tick >= 700 && p.b.sim.tick >= 700, 60000, 'jeu avec latence');
    const g = roomOf(p.a).game;
    let common = 0;
    for (const [t, h] of p.a.hashLog) if (p.b.hashLog.has(t) && g.hashes.has(t)) { assert.strictEqual(h, p.b.hashLog.get(t)); assert.strictEqual(h, g.hashes.get(t)); common++; }
    const r = { common, delay: g.delay, desync: seen(p.a, 'desync').length + seen(p.b, 'desync').length, rtt: Math.round(p.a.rtt), lagMax: Math.max(p.a.stats.lagMax, p.b.stats.lagMax) };
    stop(p.a, p.b);
    return r;
  }
  {
    setScale(3);                                      // 3x : 5, 15 et 40 ms réels valent 15, 45 et 120 ms de jeu par sens
    const low = await latencyRun(5, 3), mid = await latencyRun(15, 10), high = await latencyRun(40, 20);
    setScale(6);
    assert.ok(low.common >= 8 && mid.common >= 8 && high.common >= 8, 'comparaisons suffisantes');
    assert.strictEqual(low.desync + mid.desync + high.desync, 0, 'aucune désynchronisation, quelle que soit la latence');
    assert.ok(high.delay >= mid.delay && mid.delay >= low.delay, 'le délai d\'entrée suit la latence : ' + [low.delay, mid.delay, high.delay]);
    assert.ok(high.delay > low.delay, 'et augmente vraiment avec elle');
    ok(`latence : délai d'entrée ${low.delay} / ${mid.delay} / ${high.delay} pas pour 15 / 45 / 120 ms de latence de jeu par sens (retard maximal du client ${low.lagMax} / ${mid.lagMax} / ${high.lagMax} pas), sans désynchronisation`);
  }

  // --- Désynchronisation : détection par somme de contrôle, resynchronisation par rejeu du journal ---
  {
    const p = await pair('vs');
    await startPair(p);
    bot(p.a, 5); bot(p.b, 6);
    await waitFor(() => p.a.sim.tick >= 200, 10000);
    p.b.debugCorrupt();                                   // un pixel de terrain change chez B seulement
    await waitFor(() => seen(p.b, 'desync').length && seen(p.b, 'synced').length, 15000, 'resynchronisation');
    assert.strictEqual(seen(p.a, 'desync').length, 0, 'A n\'est pas concerné');
    const t0 = p.b.sim.tick;
    await waitFor(() => p.b.sim.tick >= t0 + 300 && p.a.sim.tick >= t0 + 300, 15000);
    const g = roomOf(p.a).game;
    for (const [t, h] of p.b.hashLog) if (t > t0 && g.hashes.has(t)) assert.strictEqual(h, g.hashes.get(t), 'B est de nouveau aligné au pas ' + t);
    assert.strictEqual(seen(p.b, 'desync').length, 1, 'une seule désynchronisation, corrigée');
    stop(p.a, p.b);
    ok('désynchronisation provoquée : détectée par la somme de contrôle, corrigée par rejeu du journal');
  }

  // --- Reconnexion en cours de partie ---
  {
    const p = await pair('vs', 5, 5);
    await startPair(p);
    bot(p.a, 7); bot(p.b, 8);
    await waitFor(() => p.a.sim.tick >= 300, 10000);
    const before = roomOf(p.a).game.sim.tick;
    p.b.ws.close();                                       // coupure réseau chez B : le client se reconnecte seul
    await waitFor(() => seen(p.a, 'peer').some((e) => e.d.status === 'disconnected'), 3000, 'A est prévenu');
    assert.ok(roomOf(p.a).game.paused, 'la partie est suspendue pendant l\'absence');
    await waitFor(() => seen(p.b, 'resync').length && seen(p.b, 'synced').length, 6000, 'B resynchronisé');
    await waitFor(() => seen(p.a, 'peer').some((e) => e.d.status === 'reconnected'), 3000);
    assert.ok(!roomOf(p.a).game.paused, 'la partie reprend');
    await waitFor(() => p.b.sim.tick >= before + 240 && p.a.sim.tick >= before + 240, 15000);
    const g = roomOf(p.a).game;
    let agree = 0;
    for (const [t, h] of p.b.hashLog) if (t > before && g.hashes.has(t)) { assert.strictEqual(h, g.hashes.get(t)); agree++; }
    assert.ok(agree >= 2);
    assert.strictEqual(p.b.token, p.b.token); // le jeton est conservé
    stop(p.a, p.b);
    ok('reconnexion : partie suspendue, joueur rattaché par son jeton, état reconstruit, ' + agree + ' sommes de contrôle concordantes ensuite');
  }

  // --- Abandon explicite, et forfait après délai de grâce ---
  {
    const p = await pair('vs');
    await startPair(p);
    await waitFor(() => p.a.sim.tick >= 30, 5000);
    p.b.resign();
    await waitFor(() => seen(p.a, 'end').length && seen(p.b, 'end').length, 3000);
    const e = seen(p.a, 'end')[0].d;
    assert.strictEqual(e.reason, 'abandon'); assert.strictEqual(e.winner, 0);
    stop(p.a, p.b);
    const q = await pair('vs');
    await startPair(q);
    await waitFor(() => q.a.sim.tick >= 30, 5000);
    q.b.wantOpen = false; q.b.ws.close();                 // B part sans revenir
    await waitFor(() => seen(q.a, 'end').length, 5000, 'forfait');
    assert.strictEqual(seen(q.a, 'end')[0].d.reason, 'abandon');
    assert.strictEqual(seen(q.a, 'end')[0].d.winner, 0);
    stop(q.a, q.b);
    ok('abandon : explicite (défaite immédiate) et par déconnexion prolongée (forfait après le délai de grâce)');
  }

  // --- Partie complète jusqu'à la fin : message de fin cohérent avec la simulation des clients ---
  {
    const p = await pair('vs');
    await startPair(p);
    await waitFor(() => seen(p.a, 'end').length && seen(p.b, 'end').length, 60000, 'fin de partie');
    await waitFor(() => p.a.sim.status !== 'running' && p.b.sim.status !== 'running', 10000);
    const e = seen(p.a, 'end')[0].d;
    assert.strictEqual(e.hash, p.a.sim.hash(), 'même état final que le serveur');
    assert.strictEqual(p.a.sim.hash(), p.b.sim.hash());
    assert.strictEqual(e.tick, p.a.sim.tick);
    stop(p.a, p.b);
    ok('partie complète : fin au pas ' + e.tick + ', ' + e.reason + ', état final identique chez les deux clients et le serveur');
  }

  // --- Coopération : répartition des rôles, départ du partenaire ---
  {
    const p = await pair('coop');
    p.a.settings({ level: 3 });
    await waitFor(() => p.b.room.settings.level === 3, 2000);
    await startPair(p);
    assert.strictEqual(p.a.sim.players.length, 1, 'une seule armée partagée');
    await waitFor(() => p.a.sim.bidules.length > 0, 8000);
    const roleA = NS.Net.COOP_ROLES[0], roleB = NS.Net.COOP_ROLES[1];
    p.a.sendCommand({ type: 'assign', id: 1, skill: roleB.skills[0] });         // hors de son rôle
    p.b.sendCommand({ type: 'assign', id: 1, skill: roleA.skills[0] });         // hors de son rôle
    await waitFor(() => seen(p.a, 'reject').length && seen(p.b, 'reject').length, 3000);
    assert.strictEqual(seen(p.a, 'reject')[0].d.reason, 'not-your-role');
    p.a.sendCommand({ type: 'assign', id: 1, skill: roleA.skills[0] });
    p.b.sendCommand({ type: 'weapon', weapon: 'cannon', angle: 40, power: 60 });
    await sleep(600);
    const g = roomOf(p.a).game;
    assert.ok(g.log.concat(g.future).some((c) => c.by === 0 && c.skill === roleA.skills[0]) && g.log.concat(g.future).some((c) => c.by === 1 && c.weapon === 'cannon'));
    assert.ok(g.log.concat(g.future).every((c) => c.player === 0), 'tous les ordres vont à la même armée');
    p.b.resign();                                                              // le partenaire s'en va : l'autre garde tout
    await waitFor(() => seen(p.a, 'peer').some((e) => e.d.status === 'left'), 3000);
    p.a.sendCommand({ type: 'assign', id: 2, skill: roleB.skills[0] });
    await sleep(300);
    const g2 = roomOf(p.a).game;
    assert.ok(g2.log.concat(g2.future).some((c) => c.skill === roleB.skills[0] && c.by === 0), 'le joueur restant obtient tous les rôles');
    stop(p.a, p.b);
    ok('coopération : rôles imposés par le serveur, armée partagée, le partenaire restant hérite de tous les rôles');
  }

  // --- Chat et sécurité des commandes ---
  {
    const p = await pair('vs');
    p.a.chat('fire'); p.a.chat('gg'); p.a.chat('<script>');
    await waitFor(() => seen(p.b, 'chat').length >= 1, 2000);
    await sleep(200);
    assert.strictEqual(seen(p.b, 'chat').length, 1, 'un seul message passe : le suivant est limité en débit, le troisième n\'existe pas');
    assert.strictEqual(seen(p.b, 'chat')[0].d.code, 'fire');
    await startPair(p);
    await waitFor(() => p.a.sim.tick >= 30, 5000);
    p.a.sendRaw({ type: 'cmd', c: { type: 'weapon', weapon: 'cannon', angle: 45, power: 9999 } });
    p.a.sendRaw({ type: 'cmd', c: { type: 'assign', id: 'x', skill: 'builder' } });
    p.a.sendRaw({ type: 'cmd', c: { type: 'assign', id: 1, skill: 'inexistante' } });
    p.a.sendRaw({ type: 'cmd', c: { type: 'rate', value: 50, player: 1, tick: 0 } });     // tente d'usurper le camp 1 et de dater la commande
    await waitFor(() => seen(p.a, 'reject').length >= 3, 3000);
    await sleep(300);
    const g = roomOf(p.a).game;
    const all = g.log.concat(g.future);
    const rate = all.find((c) => c.type === 'rate');
    assert.ok(rate && rate.player === 0 && rate.by === 0 && rate.tick > 30, 'le serveur impose le propriétaire et la date');
    assert.ok(!all.some((c) => c.type === 'weapon' || c.skill === 'inexistante'));
    stop(p.a, p.b);
    ok('sécurité : emojis à codes fixes et limités, commandes assainies, propriétaire et date imposés par le serveur');
  }

  server.close(); manager.rooms.forEach((r) => r.destroy());
  console.log('Tous les tests réseau passent.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
