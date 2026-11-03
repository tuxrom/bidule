/**
 * Campagne : 40 niveaux, 4 univers. Chaque niveau généré est rejoué par un robot
 * qui applique le plan de solution du générateur dans la VRAIE simulation ;
 * le niveau doit être gagné. On vérifie aussi la progression des armes, les
 * étoiles et la sauvegarde.
 */
const { NS } = require('./helpers');
const assert = require('assert');

const levels = NS.Campaign.all();
assert.strictEqual(levels.length, 40);
assert.deepStrictEqual([...new Set(levels.map((l) => l.world))], ['desert', 'ruins', 'arctic', 'orbital']);
assert.strictEqual(new Set(levels.map((l) => l.id)).size, 40, 'identifiants uniques');

function solve(def) {
  const sim = new NS.Simulation(def);
  const done = new Set();
  while (sim.status === 'running') {
    (def.plan || []).forEach((r, i) => {
      if (done.has(i) || (r.after && sim.tick < r.after)) return;
      // Le robot donne la compétence au Bidule de TÊTE parmi ceux qui sont dans la fenêtre.
      let lead = null;
      for (const b of sim.bidules) {
        if (b.state === 'walk' && b.dir === (r.dir || 1) && b.x >= r.x0 && b.x <= r.x1 && Math.abs(b.y - r.y) <= 2 && sim.canAssign(b, r.skill)) {
          if (!lead || b.x > lead.x) lead = b;
        }
      }
      if (lead) { sim.issue({ type: 'assign', id: lead.id, skill: r.skill }); done.add(i); }
    });
    sim.step();
  }
  return sim;
}

let fails = 0;
const rows = [];
levels.forEach((def, i) => {
  if (!def.plan) return;                     // niveaux écrits à la main : voir solutions.test.js
  const sim = solve(def);
  const pct = Math.round((sim.players[0].saved * 100) / def.count);
  const stars = NS.Campaign.stars(sim);
  rows.push(`${String(i + 1).padStart(2)} ${def.id.padEnd(10)} segs=${def.plan.length} W=${def.width} saved=${pct}%/${def.goal}% stars=${stars} ${sim.status}`);
  if (sim.status !== 'won') fails++;
});
console.log(rows.join('\n'));
assert.strictEqual(fails, 0, fails + ' niveau(x) généré(s) non gagnable(s) par le plan');

// Progression : une arme n'existe pas dans un niveau antérieur à son déblocage.
for (const [w, rank] of Object.entries(NS.Campaign.UNLOCK)) {
  if (w === 'climber') { assert.ok(!levels[rank - 2].skills.climber && levels[rank - 1].skills.climber); continue; }
  assert.ok(!(w in levels[rank - 2].weapons), w + ' trop tôt');
  assert.ok(w in levels[rank - 1].weapons, w + ' absent à son déblocage');
}
console.log('OK déblocage progressif des armes');

// Difficulté croissante.
const d = (i) => NS.Generator.params(i);
assert.ok(d(39).goal > d(3).goal && d(39).count > d(3).count && d(39).segments > d(3).segments);
console.log('OK difficulté croissante');

// Étoiles : 1 / 2 / 3 selon le pourcentage et le temps.
const fake = (saved, tick, status) => ({ status: status || 'won', tick, timeLimitTicks: 1000, players: [{ saved, count: 20, goal: 50 }] });
assert.strictEqual(NS.Campaign.stars(fake(10, 100)), 1);
assert.strictEqual(NS.Campaign.stars(fake(14, 100)), 2);
assert.strictEqual(NS.Campaign.stars(fake(18, 900)), 2);
assert.strictEqual(NS.Campaign.stars(fake(18, 700)), 3);
assert.strictEqual(NS.Campaign.stars(fake(18, 700, 'lost')), 0);
console.log('OK étoiles');

// Sauvegarde : localStorage factice.
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
const S = NS.Campaign.Save;
S.reset();
assert.ok(S.unlocked(0) && !S.unlocked(1));
assert.strictEqual(S.record(levels[0].id, 2, 80), true);
assert.strictEqual(S.record(levels[0].id, 1, 60), false);
assert.strictEqual(S.levelStars(levels[0].id), 2);
assert.ok(S.unlocked(1) && !S.unlocked(2));
S.data = { levels: {}, vs: { played: 0, won: 0, byDifficulty: {} } };
S.load();
assert.strictEqual(S.levelStars(levels[0].id), 2, 'rechargement depuis le stockage');
console.log('OK sauvegarde et déblocage des niveaux');
