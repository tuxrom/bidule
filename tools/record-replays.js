/**
 * record-replays.js : (ré)enregistre les rediffusions de référence de tests/replays/.
 *   node tools/record-replays.js
 * Chaque fichier = une partie jouée par le robot (plan de solution) + quelques ordres variés (cadence, arme,
 * bloqueur libéré, Bidule éliminé), et le résultat attendu (statut, sauvés, pas, empreinte de l'état final).
 * tests/replays.test.js rejoue ces fichiers : si une modification des règles change une partie, le test échoue.
 * Ne relancer cet outil que pour un changement de règles VOULU (et incrémenter Net.PROTOCOL).
 */
const fs = require('fs');
const path = require('path');
const { NS } = require('../tests/helpers');
const OUT = path.join(__dirname, '..', 'tests', 'replays');

const CASES = [
  { name: 'campagne-01', i: 0 },
  { name: 'campagne-02', i: 1, extra: true },
  { name: 'campagne-03', i: 2 },
  { name: 'campagne-12-armes', i: 11, weapons: true },
  { name: 'campagne-24', i: 23, weapons: true },
  { name: 'campagne-37', i: 36 }
];

for (const c of CASES) {
  const def = NS.Campaign.all()[c.i];
  const sim = new NS.Simulation(def), done = new Set();
  sim.issue({ type: 'rate', value: 55 });
  let released = false, dismissed = false;
  while (sim.status === 'running') {
    NS.Solver.play(sim, def.plan, done);
    if (c.weapons && sim.tick === 600) sim.issue({ type: 'weapon', weapon: 'recon' });
    if (c.extra) {
      // Un bloqueur de trop, posé puis libéré ; un retardataire éliminé.
      const w = sim.bidules.find((b) => b.state === 'walk' && b.y < 210 && b.x > 115 && b.x < 135);
      if (!released && sim.tick > 400 && w && sim.issue({ type: 'assign', id: w.id, skill: 'blocker' })) released = w.id;
      if (released && released !== true && sim.tick > 700) { sim.issue({ type: 'release', id: released }); released = true; }
      if (!dismissed && sim.tick > 4000 && sim.bidules.length) { sim.issue({ type: 'dismiss', id: sim.bidules[sim.bidules.length - 1].id }); dismissed = true; }
    }
    sim.step();
  }
  const rep = NS.Replay.record(sim, { k: 'campaign', i: c.i });
  rep.expect = { status: sim.status, saved: sim.players[0].saved, tick: sim.tick, hash: sim.hash() };
  fs.writeFileSync(path.join(OUT, c.name + '.json'), JSON.stringify(rep) + '\n');
  console.log(c.name, rep.expect, rep.log.length + ' ordres', rep.log.map((r) => r[1]).filter((t, k, a) => a.indexOf(t) === k).join(','));
}
