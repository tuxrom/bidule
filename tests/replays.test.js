/**
 * Rediffusions, défi du jour et vérification des scores par le serveur.
 *  1. Non-régression : chaque rediffusion de tests/replays/ doit redonner exactement le même état final
 *     (empreinte). Un changement de règles involontaire est détecté ici (si voulu : tools/record-replays.js).
 *  2. Aller-retour : enregistrer -> encoder -> décoder -> rejouer = même partie.
 *  3. Défi du jour : même niveau pour une même date, gagnable par son plan, sur deux mois.
 *  4. Serveur : un replay gagnant est accepté et classé, un replay truqué ou d'un autre jour est refusé.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { NS } = require('./helpers');
let n = 0;
const ok = (m) => console.log('OK ' + (++n) + '. ' + m);

// 1. Non-régression.
const dir = path.join(__dirname, 'replays');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const rep = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const r = NS.Replay.run(rep);
  assert.deepStrictEqual({ status: r.status, saved: r.saved, tick: r.tick, hash: r.hash }, rep.expect, f + ' : la partie a changé');
  ok('rediffusion ' + f.replace('.json', '') + ' identique (' + r.saved + ' sauvés, pas ' + r.tick + ')');
}

// 2. Aller-retour, avec des ordres de tous les types simples, et un replay altéré qui ne plante pas.
{
  const def = NS.Campaign.all()[13];
  const sim = new NS.Simulation(def), done = new Set();
  while (sim.status === 'running') {
    NS.Solver.play(sim, def.plan, done);
    if (sim.tick === 300) sim.issue({ type: 'rate', value: 70 });
    if (sim.tick === 450) sim.issue({ type: 'weapon', weapon: 'recon' });
    sim.step();
  }
  const code = NS.Replay.encode(NS.Replay.record(sim, { k: 'campaign', i: 13 }));
  assert.ok(/^[A-Za-z0-9_-]+$/.test(code), 'code utilisable dans une URL');
  const r = NS.Replay.run(NS.Replay.decode(code));
  assert.strictEqual(r.hash, sim.hash()); assert.strictEqual(r.tick, sim.tick);
  const bad = NS.Replay.decode(code);
  bad.log.push([5, 'assign', 1, 'nuke'], [7, 'evil'], 'x', [9, 'weapon', 'laser']);
  assert.strictEqual(NS.Replay.run(bad).hash, sim.hash(), 'ordres inconnus ignorés');
  assert.throws(() => NS.Replay.decode('pas-un-replay'));
  ok('replay : encodage pour URL (' + code.length + ' car.), relecture identique, ordres invalides ignorés');
}

// 3. Défi du jour.
{
  const a = NS.Daily.def('2026-11-07'), b = NS.Daily.def('2026-11-07');
  assert.strictEqual(a, b, 'cache');
  assert.ok(a.plan.length && a.daily === '2026-11-07' && /7 novembre 2026/.test(a.name));
  assert.ok(!NS.Daily.valid('2026-13-01') && !NS.Daily.valid('../../etc') && NS.Daily.valid('2027-02-28'));
  let worlds = new Set();
  for (let k = 0; k < 60; k++) {
    const date = NS.Daily.today(new Date(2026, 10, 1 + k)), def = NS.Daily.def(date);
    worlds.add(def.world);
    assert.strictEqual(NS.Solver.solve(def).status, 'won', date + ' : défi non gagnable par son plan');
  }
  assert.ok(worlds.size >= 3, 'les univers varient');
  ok('défi du jour : déterministe, gagnable chaque jour sur 60 jours, univers variés');
}

// 4. Serveur : classement vérifié par re-simulation, statistiques bornées.
{
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bidules-'));
  const { submitDaily, recordStats, server } = require('../server/server');
  const date = new Date().toISOString().slice(0, 10);
  const def = NS.Daily.def(date);
  const won = NS.Solver.solve(def);
  const rep = NS.Replay.record(won, { k: 'daily', d: date });
  let [code, out] = submitDaily({ date, name: 'Rom<script>', replay: NS.Replay.encode(rep) });
  assert.strictEqual(code, 200, JSON.stringify(out));
  assert.strictEqual(out.rank, 1); assert.strictEqual(out.board[0].name, 'Romscript'); assert.strictEqual(out.board[0].saved, won.players[0].saved);
  // Le client ment sur son score : le serveur s'en moque, il rejoue.
  [code, out] = submitDaily({ date, name: 'Tricheur', replay: Object.assign({}, rep, { log: [] }), saved: 999 });
  assert.strictEqual(code, 422, 'replay sans ordres : niveau perdu');
  [code] = submitDaily({ date: '2020-01-01', name: 'x', replay: rep });
  assert.strictEqual(code, 400, 'date trop ancienne');
  [code] = submitDaily({ date, name: 'x', replay: NS.Replay.record(won, { k: 'campaign', i: 0 }) });
  assert.strictEqual(code, 400, 'replay d\'un autre niveau');
  // Un second envoi moins bon ne remplace pas le meilleur.
  [code, out] = submitDaily({ date, name: 'rom<script>', replay: rep });
  assert.strictEqual(out.board.length, 1);
  assert.ok(recordStats({ level: 'dunes-2', result: 'quit', pct: 40, hints: 2, causes: { drown: 3, evil: 9 } }));
  assert.ok(!recordStats({ level: '../x', result: 'won' }) && !recordStats({ level: 'dunes-2', result: 'cheat' }));
  server.close();
  ok('serveur : score vérifié en rejouant, triche, mauvaise date et mauvais niveau refusés, statistiques bornées');
}
