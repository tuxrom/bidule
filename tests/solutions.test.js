/** Vérifie que chaque niveau de démonstration est gagnable avec un script. */
const { play } = require('./helpers');
const assert = require('assert');
const walk = (b) => b.state === 'walk';

const sols = [
  [ // niveau 1 : pont puis foreur
    { when: (b) => walk(b) && b.dir === 1 && b.x >= 444 && b.x < 450, skill: 'builder' },
    { when: (b) => walk(b) && b.dir === 1 && b.x >= 681 && b.y > 330, skill: 'basher' }
  ],
  [ // niveau 2 : bloqueur au bord, mineur, bloqueur dans la galerie
    { when: (b) => walk(b) && b.y < 250 && b.x >= 540, skill: 'blocker' },
    { when: (b) => walk(b) && b.y < 250 && b.x >= 150 && b.x < 160 && b.dir === 1, skill: 'miner', after: 100 },
    { when: (b) => walk(b) && b.y > 400 && b.x >= 520 && b.dir === 1, skill: 'blocker' }
  ],
  [ // niveau 3 : foreur, pont, double pont
    { when: (b) => walk(b) && b.y > 200 && b.dir === 1 && b.x >= 545 && b.x < 555, skill: 'basher' },
    { when: (b) => walk(b) && b.dir === 1 && b.x >= 692 && b.x < 700 && b.y > 200, skill: 'builder' },
    { when: (b) => walk(b) && b.dir === 1 && b.x >= 990 && b.x < 998 && b.y > 200, skill: 'builder' },
    { when: (b) => (b.state === 'walk' || b.state === 'build') && b.dir === 1 && b.x >= 1052 && b.x < 1062 && b.y > 200, skill: 'builder' }
  ]
];

let failed = 0;
sols.forEach((rules, i) => {
  const sim = play(i, rules);
  const pct = Math.round((sim.saved * 100) / sim.count);
  const ok = sim.status === 'won';
  console.log(`Niveau ${i + 1}: ${sim.status} ${sim.saved}/${sim.count} (${pct}%) tick=${sim.tick} sorti=${sim.released}`);
  if (!ok) failed++;
});
assert.strictEqual(failed, 0, failed + ' niveau(x) non gagné(s)');
