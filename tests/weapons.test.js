/** Tests des armes, du grimpeur, des pièges, du brouillard et du mode à deux armées. */
const { NS } = require('./helpers');
const assert = require('assert');
const M = NS.M;

const ALL_W = { recon: 3, kdrone: 3, satellite: 2, cannon: 4, shield: 3, zipline: 3, jetpack: 5, grapple: 5, mine: 4, tank: 2, jammer: 2 };
function mini(ops, extra) {
  const sim = new NS.Simulation(Object.assign({
    id: 't', name: 't', width: 600, height: 300, seed: 9, hatch: { x: 30, y: 10, dir: 1 }, exit: { x: 580, y: 249 },
    count: 0, goal: 50, timeLimit: 900, skills: { climber: 5, floater: 5, builder: 5 }, weapons: ALL_W,
    points: { start: 500, regen: 1 }, cannon: { x: 40, y: 249, dir: 1 }, terrain: ops
  }, extra || {}));
  // Trappe figée : la partie ne se termine pas d'elle-même pendant les essais.
  for (const p of sim.players) { p.count = 1; p.spawnCountdown = 1e9; }
  return sim;
}
function add(sim, x, y, state, dir, owner) {
  const b = new NS.Bidule(sim.nextId++, x, y, dir || 1, owner || 0);
  b.state = state || 'walk';
  sim.bidules.push(b);
  return b;
}
const run = (s, n) => { for (let i = 0; i < n; i++) s.step(); };
const fire = (s, weapon, o) => s.issue(Object.assign({ type: 'weapon', weapon }, o));
const TWO = { players: [{ hatch: { x: 30, y: 10, dir: 1 }, exit: { x: 580, y: 249 } }, { hatch: { x: 570, y: 10, dir: -1 }, exit: { x: 30, y: 249 } }] };
const floor = { op: 'rect', m: 'sand', x: 0, y: 250, w: 600, h: 50 };
let n = 0;
const ok = (m) => console.log('OK ' + (++n) + '. ' + m);

// Économie : points, stock, recharge.
{
  const s = mini([floor], { points: { start: 40, regen: 0 } });
  assert.ok(fire(s, 'shield', { x: 100, y: 240 }));                       // 20 pts
  assert.strictEqual(s.players[0].points, 20);
  assert.ok(!fire(s, 'shield', { x: 100, y: 240 })); assert.strictEqual(s.denied, 'En recharge');
  run(s, 760);
  assert.ok(fire(s, 'shield', { x: 100, y: 240 }));                       // 0 pts
  run(s, 760);
  assert.ok(!fire(s, 'shield', { x: 100, y: 240 })); assert.strictEqual(s.denied, 'Points insuffisants');
  const t = mini([floor]);
  for (let i = 0; i < 3; i++) { assert.ok(fire(t, 'recon')); run(t, 1250); }
  assert.ok(!fire(t, 'recon')); assert.strictEqual(t.denied, 'Stock épuisé');
  ok('points, stock limité et recharge appliqués');
}
// Régénération des points : 1 par seconde.
{ const s = mini([floor], { points: { start: 0, regen: 2 } }); run(s, 90); assert.strictEqual(s.players[0].points, 6); ok('régénération des points'); }
// Drone de reconnaissance : lève le brouillard 20 s.
{
  const s = mini([floor], { fog: true });
  assert.ok(!s.canSee(0, 400, 200));
  fire(s, 'recon');
  assert.ok(s.canSee(0, 400, 200));
  run(s, 601);
  assert.ok(!s.canSee(0, 400, 200));
  ok('drone de reconnaissance : brouillard levé 20 s');
}
// Pièges cachés : tuent, sont désamorcés par une explosion.
{
  const s = mini([floor], { traps: [{ x: 200, y: 249 }, { x: 400, y: 249 }] });
  const a = add(s, 190, 249, 'walk'); add(s, 150, 249, 'block');
  run(s, 20);
  assert.strictEqual(a.state, 'dead'); assert.strictEqual(s.players[0].deadBy.trap, 1);
  assert.ok(s.traps[0].alive === false && s.traps[1].alive);
  s.blast(400, 245, 20);
  assert.ok(!s.traps[1].alive);
  ok('pièges : mortels, désamorçables par explosion');
}
// Satellite : colonne sur toute la hauteur, roche comprise, tue ce qui s'y trouve.
{
  const s = mini([floor, { op: 'rect', m: 'rock', x: 300, y: 200, w: 40, h: 100 }]);
  const v = add(s, 310, 199, 'block');
  const other = add(s, 100, 249, 'block');
  fire(s, 'satellite', { x: 310 });
  run(s, 80);
  assert.strictEqual(s.terrain.get(310, 5), M.AIR); assert.strictEqual(s.terrain.get(310, 299), M.AIR); assert.strictEqual(s.terrain.get(310, 220), M.AIR);
  assert.strictEqual(s.terrain.get(330, 220), M.ROCK, 'colonne étroite');
  assert.strictEqual(v.state, 'dead'); assert.notStrictEqual(other.state, 'dead');
  assert.strictEqual(s.players[0].weapons.satellite.cd > 2000, true, 'recharge longue');
  ok('satellite : colonne pleine hauteur, perce la roche, recharge longue');
}
// Canon : déterministe, cratère large, ne dépend pas de Math.sin.
{
  const a = mini([floor]), b = mini([floor]);
  const land = (s) => { fire(s, 'cannon', { angle: 45, power: 60 }); run(s, 400); return s.terrain.hash(); };
  assert.strictEqual(land(a), land(b));
  const t = NS.Weapons.byId.cannon.trajectory(a, a.players[0], 45, 60);
  assert.ok(t.hit && t.x > 150 && t.x < 600, 'portée plausible, x=' + t.x);
  assert.ok(a.terrain.get(t.x, 249) === M.AIR && a.terrain.countRect(t.x - 30, 250, t.x + 30, 290, NS.SOLID) < 61 * 41, 'cratère');
  const lo = NS.Weapons.byId.cannon.trajectory(a, a.players[0], 45, 30), hi = NS.Weapons.byId.cannon.trajectory(a, a.players[0], 45, 90);
  assert.ok(hi.x > lo.x, 'plus de puissance, plus de portée');
  assert.ok(Math.abs(NS.sinDeg(30) - 0.5) < 1e-9 && Math.abs(NS.cosDeg(60) - 0.5) < 1e-9);
  ok('canon : tir déterministe, portée croissante, cratère (impact x=' + t.x + ')');
}
// Drone kamikaze : piloté, détonation sur ordre ; tue l'ennemi, pas de tir ami sur les murs.
{
  const s = mini([floor], TWO);
  const enemy = add(s, 300, 249, 'block', 1, 1);
  fire(s, 'kdrone', { x: 300, y: 150 });
  run(s, 20);
  assert.ok(s.entities.some((e) => e.kind === 'drone'));
  assert.ok(!fire(s, 'kdrone', {}) );
  s.issue({ type: 'steer', x: 300, y: 240 });
  run(s, 300);
  assert.strictEqual(s.entities.some((e) => e.kind === 'drone'), false, 'le drone a explosé');
  assert.strictEqual(enemy.state, 'dead'); assert.strictEqual(s.players[0].stats.kills, 1);
  const g = mini([floor]);
  assert.strictEqual(g.terrain.get(300, 252), M.SAND);
  fire(g, 'kdrone', { x: 300, y: 262 });
  run(g, 300);
  assert.strictEqual(g.terrain.get(300, 252), M.AIR, 'cratère dans le sol');
  assert.ok(g.terrain.isSolid(300, 275), 'le cratère reste une calotte peu profonde');
  ok('drone kamikaze piloté');
}
// Bouclier : protège d'une explosion pendant 15 s, plus après.
{
  const hit = (withShield, wait) => {
    const s = mini([floor]);
    const a = add(s, 100, 249, 'block'), b = add(s, 120, 249, 'block');
    if (withShield) fire(s, 'shield', { x: 100, y: 245 });
    run(s, wait);
    s.blast(110, 245, 30);
    return [a.state, b.state];
  };
  assert.deepStrictEqual(hit(true, 10), ['block', 'block']);
  assert.deepStrictEqual(hit(false, 10), ['dead', 'dead']);
  assert.deepStrictEqual(hit(true, 460), ['dead', 'dead']);
  ok('bouclier : protège 15 s puis disparaît');
}
// Tyrolienne : franchit un gouffre de lave.
{
  const s = mini([floor, { op: 'rect', m: 'air', x: 200, y: 250, w: 150, h: 50 }, { op: 'rect', m: 'lava', x: 200, y: 280, w: 150, h: 20 }]);
  const b = add(s, 150, 249, 'walk');
  assert.ok(!fire(s, 'zipline', { x1: 190, y1: 235, x2: 400, y2: 236 }), 'câble trop plat/long refusé');
  assert.ok(fire(s, 'zipline', { x1: 190, y1: 230, x2: 360, y2: 240 }));
  run(s, 200);
  assert.ok(b.x > 362 && b.state !== 'dead', 'a traversé, x=' + b.x + ' ' + b.state);
  ok('tyrolienne franchit un gouffre');
}
// Jetpack : survole un mur.
{
  const s = mini([floor, { op: 'rect', m: 'sand', x: 200, y: 190, w: 20, h: 60 }]);
  const b = add(s, 150, 249, 'walk');
  fire(s, 'jetpack', { id: b.id });
  run(s, 320);
  assert.ok(b.x > 225 && b.state === 'walk', 'passé le mur, x=' + b.x + ' ' + b.state);
  ok('jetpack survole un mur de 60 px');
}
// Grappin : escalade une falaise, refuse un mur plein.
{
  const s = mini([floor, { op: 'rect', m: 'sand', x: 200, y: 180, w: 100, h: 70 }]);
  const b = add(s, 190, 249, 'walk', 1);
  assert.ok(fire(s, 'grapple', { id: b.id, x: 205, y: 179 }));
  run(s, 60);
  assert.ok(b.y <= 180 && b.x >= 199 && b.state === 'walk', 'en haut, (' + b.x + ',' + b.y + ')');
  const c = add(s, 150, 249, 'walk', 1);
  assert.ok(!fire(s, 'grapple', { id: c.id, x: 250, y: 100 }), 'cible hors portée/aucune surface');
  ok('grappin : escalade une falaise de 70 px');
}
// Mine télécommandée : explose sur ordre, tue amis et ennemis.
{
  const s = mini([floor], TWO);
  fire(s, 'mine', { x: 300, y: 249 });
  const e = add(s, 305, 249, 'block', 1, 1);
  run(s, 30);
  assert.strictEqual(e.state, 'block');
  s.issue({ type: 'detonate' });
  assert.strictEqual(e.state, 'dead');
  assert.strictEqual(s.players[0].stats.kills, 1);
  ok('mine télécommandée');
}
// Char : embarque, laboure un mur de sable, traverse la lave, sauve ses passagers.
{
  const s = mini([floor, { op: 'rect', m: 'sand', x: 200, y: 150, w: 30, h: 100 }, { op: 'rect', m: 'lava', x: 300, y: 250, w: 60, h: 50 }], { exit: { x: 450, y: 249 } });
  fire(s, 'tank', { x: 100, y: 249 });
  const riders = [add(s, 100, 249), add(s, 98, 249), add(s, 102, 249)];
  run(s, 20);
  assert.ok(riders.every((r) => r.state === 'rider'), 'embarqués');
  run(s, 520);
  assert.strictEqual(s.players[0].saved, 3, 'sauvés par le char, saved=' + s.players[0].saved);
  ok('char d\'assaut : plowing, amphibie, passagers sauvés');
}
// Grimpeur : escalade un mur de 50 px ; sans la compétence, demi-tour.
{
  const s = mini([floor, { op: 'rect', m: 'sand', x: 200, y: 200, w: 20, h: 50 }]);
  const a = add(s, 150, 249, 'walk'), b = add(s, 100, 249, 'walk');
  s.issue({ type: 'assign', id: a.id, skill: 'climber' });
  run(s, 200);
  assert.ok(a.x > 221, 'le grimpeur est passé, x=' + a.x);
  assert.ok(b.x < 200, 'l\'autre est bloqué, x=' + b.x);
  ok('grimpeur escalade un mur de 50 px');
}
// Deux armées : compteurs séparés, bloqueurs et sorties par camp, victoire au score.
{
  const def = {
    id: 'v', name: 'v', width: 600, height: 300, seed: 3, timeLimit: 120, mode: 'vs',
    skills: { blocker: 2 }, weapons: ALL_W, points: { start: 100, regen: 1 },
    players: [{ hatch: { x: 40, y: 200, dir: 1 }, exit: { x: 560, y: 249 }, count: 3 }, { hatch: { x: 560, y: 200, dir: -1 }, exit: { x: 40, y: 249 }, count: 3 }],
    terrain: [floor, { op: 'rect', m: 'rock', x: 0, y: 0, w: 6, h: 300 }, { op: 'rect', m: 'rock', x: 594, y: 0, w: 6, h: 300 }]
  };
  const s = new NS.Simulation(def);
  assert.strictEqual(s.players.length, 2);
  let g = 0;
  while (s.status === 'running' && g++ < 3000) s.step();
  assert.deepStrictEqual([s.players[0].saved, s.players[1].saved], [3, 3]);
  assert.strictEqual(s.status, 'draw');
  const s2 = new NS.Simulation(def);
  s2.players[1].count = 3;
  s2.issue({ type: 'weapon', weapon: 'satellite', player: 1, x: 300 });
  run(s2, 10);
  assert.strictEqual(s2.players[0].weapons.satellite.stock, 2, 'les stocks sont séparés');
  assert.strictEqual(s2.players[1].weapons.satellite.stock, 1);
  ok('deux armées symétriques : égalité parfaite sans intervention, stocks séparés');
}
// Annulation d'un tir d'arme : l'instantané restaure points, stock, entités.
{
  const s = mini([floor]);
  const snap = s.snapshot(), h = s.hash();
  fire(s, 'shield', { x: 100, y: 240 }); run(s, 5);
  s.restore(snap);
  assert.strictEqual(s.hash(), h); assert.strictEqual(s.entities.length, 0); assert.strictEqual(s.players[0].weapons.shield.stock, 3);
  ok('annulation restaure points, stock et entités');
}

// Brouilleur radar : l'adversaire ne tire plus, ne pilote plus, ne détone plus, pendant 10 s ; moi si.
{
  const s = mini([floor], TWO);
  fire(s, 'mine', { x: 300, y: 249, player: 1 });
  assert.ok(s.players[1].weapons.mine.stock === 3, 'la mine adverse est posée');
  assert.ok(fire(s, 'jammer'));
  assert.ok(!fire(s, 'shield', { x: 100, y: 240, player: 1 })); assert.ok(/Brouillé/.test(s.denied));
  assert.ok(!s.issue({ type: 'detonate', player: 1 }), 'pas de détonation télécommandée');
  assert.ok(fire(s, 'shield', { x: 100, y: 240 }), 'le brouilleur ne gêne pas son propriétaire');
  run(s, 301);
  assert.ok(fire(s, 'shield', { x: 150, y: 240, player: 1 }), 'le brouillage prend fin au bout de 10 s');
  assert.ok(s.issue({ type: 'detonate', player: 1 }));
  ok('brouilleur radar : 10 s sans arme, sans pilotage, sans détonation');
}
