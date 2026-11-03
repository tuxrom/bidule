/**
 * Déterminisme : deux simulations alimentées par la même graine et les mêmes
 * commandes doivent avoir exactement le même état, pas après pas.
 * Vérifie aussi l'instantané/restauration (annulation) et la rediffusion
 * depuis le journal de commandes.
 */
const { NS } = require('./helpers');
const assert = require('assert');

function run(levelIdx, script, ticks, hook) {
  const sim = new NS.Simulation(NS.Loader.levels[levelIdx]);
  const hashes = [];
  for (let i = 0; i < ticks; i++) {
    for (const c of script) if (c.tick === sim.tick) sim.issue({ type: c.type, id: c.id, skill: c.skill, value: c.value });
    sim.step();
    if (i % 50 === 0) hashes.push(sim.hash());
    if (hook) hook(sim, i);
  }
  return { sim, hashes };
}

const script = [
  { tick: 100, type: 'assign', id: 1, skill: 'floater' },
  { tick: 150, type: 'assign', id: 2, skill: 'bomber' },
  { tick: 200, type: 'rate', value: 80 },
  { tick: 260, type: 'assign', id: 3, skill: 'digger' },
  { tick: 400, type: 'assign', id: 4, skill: 'basher' }
];

// 1. Deux exécutions identiques.
const a = run(0, script, 1500), b = run(0, script, 1500);
assert.deepStrictEqual(a.hashes, b.hashes, 'les empreintes divergent');
assert.strictEqual(a.sim.hash(), b.sim.hash());
console.log('OK exécutions identiques, hash final', a.sim.hash());

// 2. Une graine différente change le monde (spawns + cratères aléatoires).
const def = Object.assign({}, NS.Loader.levels[0], { seed: 777 });
const c = new NS.Simulation(def);
for (let i = 0; i < 1500; i++) c.step();
assert.notStrictEqual(c.hash(), a.sim.hash());
console.log('OK graine différente => état différent');

// 3. Rediffusion depuis le journal.
const replay = new NS.Simulation(NS.Loader.levels[0]);
const log = a.sim.log.slice();
for (let i = 0; i < 1500; i++) {
  for (const cmd of log) if (cmd.tick === replay.tick) replay.queue.push(Object.assign({}, cmd));
  replay.step();
}
assert.strictEqual(replay.hash(), a.sim.hash(), 'la rediffusion diffère');
console.log('OK rediffusion du journal (' + log.length + ' commandes)');

// 4. Instantané puis restauration : on rejoue la suite et on retrouve le même état.
const s = new NS.Simulation(NS.Loader.levels[0]);
for (let i = 0; i < 600; i++) s.step();
const snap = s.snapshot();
const h600 = s.hash();
for (let i = 0; i < 300; i++) s.step();
const h900 = s.hash();
s.restore(snap);
assert.strictEqual(s.hash(), h600, 'restauration incorrecte');
for (let i = 0; i < 300; i++) s.step();
assert.strictEqual(s.hash(), h900, 'la suite diverge après restauration');
console.log('OK instantané/restauration');

// 5. Mécaniques de base.
const t = new NS.Terrain(50, 50);
t.paintRect(0, 30, 50, 20, NS.M.SAND);
t.paintRect(10, 30, 5, 5, NS.M.ROCK);
const n = t.carveCircle(25, 35, 6);
assert.ok(n > 80, 'cratère trop petit');
assert.strictEqual(t.get(12, 32), NS.M.ROCK, 'la roche doit résister');
assert.strictEqual(t.get(25, 35), NS.M.AIR);
console.log('OK terrain destructible (' + n + ' pixels retirés)');

// 6. Un niveau exporté en JSON puis relu donne exactement la même partie.
const fs = require('fs');
const path = require('path');
const txt = fs.readFileSync(path.join(__dirname, '..', 'levels', 'dunes-1.json'), 'utf8');
const fromFile = new NS.Simulation(NS.Loader.fromJSON(txt));
const fromCode = new NS.Simulation(NS.Loader.levels[0]);
for (let i = 0; i < 400; i++) { fromFile.step(); fromCode.step(); }
assert.strictEqual(fromFile.hash(), fromCode.hash());
console.log('OK niveau JSON relu depuis le disque');

// 7. Image de masque : les couleurs de la palette deviennent des matériaux.
const mask = { width: 3, height: 1, data: new Uint8ClampedArray([0xd9, 0xa4, 0x41, 255, 0x6b, 0x3f, 0x3a, 255, 0, 0, 0, 0]) };
const mt = new NS.Terrain(3, 1);
NS.Loader.paintMask(mt, mask);
assert.deepStrictEqual([...mt.data], [NS.M.SAND, NS.M.ROCK, NS.M.AIR]);
console.log('OK image de masque');
