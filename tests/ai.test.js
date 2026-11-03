/**
 * IA : équité, déterminisme et niveaux de difficulté. Des armées pilotées par
 * l'IA s'affrontent dans la vraie simulation sur des cartes symétriques.
 */
const { NS } = require('./helpers');
const assert = require('assert');

function vsDef(seed, segments) {
  return NS.Generator.buildVS({ id: 'vs-' + seed, name: 'Duel', theme: 'desert', seed, segments: segments || 3, traps: 1, count: 20 });
}

/** Joue un match complet ; `a` et `b` sont les niveaux d'IA (ou null : armée inactive). */
function match(def, a, b, seed) {
  const sim = new NS.Simulation(def);
  const ai = [a && new NS.AI.Controller(sim, 0, a, 11 + seed), b && new NS.AI.Controller(sim, 1, b, 77 + seed)];
  const t0 = Date.now();
  while (sim.status === 'running') {
    if (ai[0]) ai[0].update();
    if (ai[1]) ai[1].update();
    sim.step();
  }
  return {
    sim, status: sim.status, s0: sim.players[0].saved, s1: sim.players[1].saved, k0: sim.players[0].stats.kills, k1: sim.players[1].stats.kills,
    w0: sim.players[0].stats.weapons, w1: sim.players[1].stats.weapons, ms: Date.now() - t0, plan: [ai[0] && ai[0].planMs, ai[1] && ai[1].planMs]
  };
}
module.exports = { vsDef, match };
if (require.main !== module) return;

// 1. Équité : stocks, points, recharges identiques au départ ; la carte est un miroir exact.
{
  const def = vsDef(5);
  const sim = new NS.Simulation(def);
  const [p0, p1] = sim.players;
  assert.deepStrictEqual(p0.skills, p1.skills);
  assert.deepStrictEqual(p0.weapons, p1.weapons);
  assert.strictEqual(p0.points, p1.points); assert.strictEqual(p0.regen, p1.regen); assert.strictEqual(p0.count, p1.count);
  const t = sim.terrain;
  let asym = 0;
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) if (t.get(x, y) !== t.get(t.w - 1 - x, y)) asym++;
  assert.strictEqual(asym, 0, 'carte asymétrique : ' + asym + ' pixels');
  assert.strictEqual(p0.exit.x + p1.exit.x + 1, def.width, 'sorties symétriques');
  assert.strictEqual(p0.hatch.x + p1.hatch.x + 1, def.width, 'trappes symétriques');
  console.log('OK équité : stocks, points et carte identiques (carte miroir parfaite, ' + def.width + ' px)');
}

// 2. L'IA ne passe que par des commandes autorisées et ne triche pas.
{
  const r = match(vsDef(7), 'hard', 'hard', 7);
  const types = new Set(r.sim.log.map((c) => c.type));
  for (const t of types) assert.ok(['assign', 'weapon', 'steer', 'detonate', 'rate'].includes(t), 'commande inconnue ' + t);
  for (const c of r.sim.log) assert.ok(c.player === 0 || c.player === 1);
  // Aucun stock négatif : les ordres de l'IA sont soumis aux mêmes contrôles que ceux du joueur.
  for (const p of r.sim.players) for (const id in p.weapons) assert.ok(p.weapons[id].stock >= 0);
  assert.ok(r.sim.players.every((p) => p.points >= 0));
  console.log('OK commandes de l\'IA : ' + [...types].join(', ') + ' (' + r.sim.log.length + ' au total)');
}

// 3. Déterminisme : même carte, mêmes IA => même partie.
{
  const a = match(vsDef(3), 'medium', 'hard', 3), b = match(vsDef(3), 'medium', 'hard', 3);
  assert.strictEqual(a.sim.hash(), b.sim.hash());
  console.log('OK parties identiques à graine identique (hash ' + a.sim.hash() + ')');
}

// 4. Hiérarchie : difficile > moyen > facile, mesurée sur plusieurs cartes, camps échangés.
{
  const seeds = [1, 2, 3, 4, 5, 6];
  const duel = (lo, hi) => {
    let hiWins = 0, loWins = 0, rows = [];
    for (const sd of seeds) {
      for (const swap of [false, true]) {
        const def = vsDef(sd, 2 + (sd % 3));
        const r = swap ? match(def, hi, lo, sd) : match(def, lo, hi, sd);
        const hiS = swap ? r.s0 : r.s1, loS = swap ? r.s1 : r.s0;
        if (hiS > loS) hiWins++; else if (loS > hiS) loWins++;
        rows.push(hiS + ':' + loS);
      }
    }
    console.log(`   ${hi} contre ${lo} : ${hi} gagne ${hiWins}, ${lo} gagne ${loWins}, nul ${seeds.length * 2 - hiWins - loWins}   [${rows.join(' ')}]`);
    return { hiWins, loWins };
  };
  const mE = duel('easy', 'medium'), hM = duel('medium', 'hard'), hE = duel('easy', 'hard');
  assert.ok(mE.hiWins > mE.loWins, 'le moyen doit battre le facile');
  assert.ok(hE.hiWins > hE.loWins, 'le difficile doit battre le facile');
  assert.ok(hM.hiWins >= hM.loWins, 'le difficile ne doit pas perdre contre le moyen');
  console.log('OK hiérarchie des niveaux de difficulté');
}
