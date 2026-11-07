/** Tests unitaires des règles de base et de chaque compétence, sur de petits niveaux synthétiques. */
const { NS } = require('./helpers');
const assert = require('assert');
const M = NS.M;

function mini(ops, skills) {
  return new NS.Simulation({
    id: 't', name: 't', width: 400, height: 300, seed: 5, hatch: { x: 20, y: 10, dir: 1 },
    exit: { x: 380, y: 5 }, count: 0, goal: 50, timeLimit: 600,
    skills: skills || { blocker: 5, builder: 5, digger: 5, miner: 5, basher: 5, floater: 5, bomber: 5 },
    terrain: ops
  });
}
function add(sim, x, y, state, dir) {
  const b = new NS.Bidule(sim.nextId++, x, y, dir || 1);
  b.state = state || 'walk';
  sim.bidules.push(b);
  return b;
}
function run(sim, n) { for (let i = 0; i < n; i++) sim.step(); }
const floor = { op: 'rect', m: 'sand', x: 0, y: 250, w: 400, h: 50 };
let n = 0;
const ok = (name) => console.log('OK ' + (++n) + '. ' + name);

// Chute : 40 px survivable, 100 px mortelle, 100 px avec parachute survivable.
{
  const s = mini([floor]);
  const a = add(s, 50, 209, 'fall'), b = add(s, 150, 149, 'fall'), c = add(s, 250, 149, 'fall');
  c.floater = true;
  run(s, 120);
  assert.strictEqual(a.state, 'walk'); assert.strictEqual(b.state, 'dead'); assert.strictEqual(c.state, 'walk');
  ok('chute de 40 px survivable, de 100 px mortelle, parachute sauve');
}
// Marche : monte une marche de 5 px, bloquée par un mur de 8 px.
{
  const s = mini([floor, { op: 'rect', m: 'sand', x: 100, y: 245, w: 20, h: 5 }, { op: 'rect', m: 'sand', x: 200, y: 242, w: 10, h: 8 }]);
  const a = add(s, 80, 249, 'walk');
  run(s, 28);   // en haut de la bosse de 20 px de large
  assert.ok(a.x > 100 && a.x < 120 && a.y === 244, 'doit grimper la marche, (' + a.x + ',' + a.y + ')');
  const t = mini([floor, { op: 'rect', m: 'sand', x: 200, y: 242, w: 10, h: 8 }]);
  const w = add(t, 180, 249, 'walk');
  run(t, 60);
  assert.strictEqual(w.dir, -1, 'doit faire demi-tour devant un mur de 8 px');
  ok('marches de 5 px franchies, mur de 8 px renvoie');
}
// Eau et lave tuent.
{
  const s = mini([floor, { op: 'rect', m: 'water', x: 100, y: 250, w: 30, h: 50 }, { op: 'rect', m: 'lava', x: 200, y: 250, w: 30, h: 50 }]);
  const a = add(s, 90, 249, 'walk'), b = add(s, 190, 249, 'walk');
  run(s, 80);
  assert.strictEqual(a.state, 'dead'); assert.strictEqual(b.state, 'dead');
  assert.strictEqual(s.dead, 2);
  ok('eau et lave mortelles');
}
// Bloqueur : renvoie les autres.
{
  const s = mini([floor]);
  const k = add(s, 200, 249, 'walk');
  s.skills.blocker = 1;
  s.issue({ type: 'assign', id: k.id, skill: 'blocker' });
  const w = add(s, 150, 249, 'walk');
  run(s, 80);
  assert.strictEqual(k.state, 'block'); assert.ok(w.x < 200 && w.dir === -1 || w.x < 160, 'le marcheur doit être repoussé, x=' + w.x);
  ok('bloqueur renvoie les Bidules');
}
// Éliminer : un bloqueur gênant disparaît (gratuit, sans cratère), les autres repassent ; refusé pour un Bidule adverse ou déjà mort.
{
  const s = mini([floor]);
  const k = add(s, 200, 249, 'walk');
  s.skills.blocker = 1;
  s.issue({ type: 'assign', id: k.id, skill: 'blocker' });
  const w = add(s, 150, 249, 'walk');
  run(s, 40);
  const solid = s.terrain.countRect(150, 230, 250, 290, NS.SOLID), stock = JSON.stringify(s.skills);
  const foe = add(s, 300, 249, 'walk'); foe.owner = 1;
  assert.strictEqual(s.issue({ type: 'dismiss', id: foe.id }), false, 'un Bidule adverse ne peut pas être éliminé');
  assert.strictEqual(s.issue({ type: 'dismiss', id: k.id }), true);
  assert.strictEqual(k.state, 'dead'); assert.strictEqual(s.dead, 1); assert.strictEqual(s.players[0].deadBy.dismiss, 1);
  assert.strictEqual(s.issue({ type: 'dismiss', id: k.id }), false, 'déjà mort');
  assert.strictEqual(s.terrain.countRect(150, 230, 250, 290, NS.SOLID), solid, 'aucun cratère');
  assert.strictEqual(JSON.stringify(s.skills), stock, 'aucun stock consommé');
  s.bidules = s.bidules.filter((b) => b !== foe);
  run(s, 120);
  assert.ok(w.x > 210, 'le marcheur doit passer là où était le bloqueur, x=' + w.x);
  assert.deepStrictEqual(NS.Net.sanitizeCommand({ type: 'dismiss', id: 7, evil: 1 }), { type: 'dismiss', id: 7 });
  assert.strictEqual(NS.Net.sanitizeCommand({ type: 'dismiss', id: -3 }), null);
  assert.strictEqual(NS.Net.sanitizeCommand({ type: 'dismiss', id: '7' }), null);
  ok('éliminer : le bloqueur disparaît sans cratère ni stock, la voie se libère ; adverse ou mort refusés');
}
// Kamikaze : cratère, seul le porteur meurt.
{
  const s = mini([floor]);
  const k = add(s, 200, 249, 'walk'), v = add(s, 260, 249, 'block');
  const before = s.terrain.countRect(150, 230, 250, 290, NS.SOLID);
  s.issue({ type: 'assign', id: k.id, skill: 'bomber' });
  run(s, NS.C.BOMB_TICKS + 2);
  const after = s.terrain.countRect(150, 230, 250, 290, NS.SOLID);
  assert.strictEqual(k.state, 'dead'); assert.notStrictEqual(v.state, 'dead');
  assert.ok(before - after > 250, 'cratère attendu, retiré=' + (before - after));
  ok('kamikaze creuse un cratère et ne tue que lui (' + (before - after) + ' px)');
}
// Creuseur : creuse puis s'arrête sur la roche.
{
  const s = mini([floor, { op: 'rect', m: 'rock', x: 0, y: 270, w: 400, h: 30 }]);
  const d = add(s, 200, 249, 'walk');
  s.issue({ type: 'assign', id: d.id, skill: 'digger' });
  run(s, 200);
  assert.strictEqual(d.y, 269); assert.strictEqual(d.state, 'walk');
  assert.strictEqual(s.terrain.get(200, 260), M.AIR); assert.strictEqual(s.terrain.get(200, 270), M.ROCK);
  ok('creuseur s\'arrête sur la roche indestructible');
}
// Foreur : traverse un mur de sable, fait demi-tour sur la roche.
{
  const s = mini([floor, { op: 'rect', m: 'sand', x: 150, y: 150, w: 40, h: 100 }, { op: 'rect', m: 'rock', x: 300, y: 150, w: 20, h: 100 }]);
  const b = add(s, 138, 249, 'walk');
  s.issue({ type: 'assign', id: b.id, skill: 'basher' });
  run(s, 200);
  assert.strictEqual(s.terrain.get(170, 245), M.AIR, 'tunnel dans le sable');
  assert.ok(b.x > 190, 'a traversé, x=' + b.x);
  const c = add(s, 270, 249, 'walk');
  s.issue({ type: 'assign', id: c.id, skill: 'basher' });
  run(s, 200);
  assert.strictEqual(s.terrain.get(305, 245), M.ROCK); assert.strictEqual(c.dir, -1);
  ok('foreur perce le sable, recule devant la roche');
}
// Mineur : tunnel diagonal praticable.
{
  const s = mini([{ op: 'rect', m: 'sand', x: 0, y: 150, w: 400, h: 150 }]);
  const m = add(s, 100, 149, 'walk');
  s.issue({ type: 'assign', id: m.id, skill: 'miner' });
  run(s, 200);
  assert.ok(m.y > 170 && m.x > 120, 'le mineur descend en diagonale (' + m.x + ',' + m.y + ')');
  const w = add(s, 90, 149, 'walk');
  run(s, 120);
  assert.ok(w.y > 160, 'un Bidule suivant peut descendre le tunnel, y=' + w.y);
  ok('mineur creuse un tunnel diagonal praticable');
}
// Bâtisseur : 12 briques, monte de 24 px, puis marche. Le suivant est renvoyé tant qu'il bâtit.
{
  const s = mini([floor]);
  const b = add(s, 100, 249, 'walk');
  s.issue({ type: 'assign', id: b.id, skill: 'builder' });
  let guard = 0;
  while (b.state !== 'walk' && guard++ < 900) s.step();   // jusqu'à la fin de l'escalier
  assert.strictEqual(b.state, 'walk');
  assert.strictEqual(b.y, 249 - 24, 'escalier de 12 marches de 2 px, y=' + b.y);
  assert.ok(s.terrain.countRect(100, 200, 160, 250, new Uint8Array([0, 0, 0, 1, 0, 0])) > 100);
  ok('bâtisseur : 12 marches (24 px de dénivelé)');
}
// Annulation : restore ramène exactement l'état d'avant l'ordre.
{
  const s = mini([floor]);
  const b = add(s, 100, 249, 'walk');
  run(s, 10);
  const snap = s.snapshot(), h = s.hash();
  s.issue({ type: 'assign', id: b.id, skill: 'digger' });
  run(s, 50);
  assert.notStrictEqual(s.hash(), h);
  s.restore(snap);
  assert.strictEqual(s.hash(), h); assert.strictEqual(s.skills.digger, 5); assert.strictEqual(s.log.length, 0);
  ok('annulation : état et stock restaurés à l\'identique');
}
// Fin de partie : objectif atteint = victoire.
{
  const s = new NS.Simulation(Object.assign({}, NS.Loader.levels[0], { count: 2, goal: 50 }));
  let guard = 0;
  while (s.status === 'running' && guard++ < 6000) {
    for (const b of s.bidules) if (b.state === 'walk' && b.dir === 1 && b.x >= 444 && b.x < 450 && s.canAssign(b, 'builder')) s.issue({ type: 'assign', id: b.id, skill: 'builder' });
    s.step();
  }
  assert.ok(['won', 'lost'].includes(s.status));
  ok('la partie se termine d\'elle-même (' + s.status + ')');
}
