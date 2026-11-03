/**
 * helpers.js - charge les modules du moteur sous Node, dans l'ordre d'index.html,
 * et fournit de quoi piloter une simulation avec un "robot" de test.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = [
  'js/core/constants.js', 'js/core/rng.js', 'js/core/mathx.js', 'js/engine/terrain.js',
  'js/skills/registry.js', 'js/weapons/registry.js', 'js/bidules/bidule.js',
  'js/skills/blocker.js', 'js/skills/builder.js', 'js/skills/digger.js', 'js/skills/miner.js',
  'js/skills/basher.js', 'js/skills/floater.js', 'js/skills/bomber.js', 'js/skills/climber.js',
  'js/weapons/recon.js', 'js/weapons/kdrone.js', 'js/weapons/satellite.js', 'js/weapons/cannon.js', 'js/weapons/shield.js',
  'js/weapons/zipline.js', 'js/weapons/jetpack.js', 'js/weapons/grapple.js', 'js/weapons/mine.js', 'js/weapons/tank.js',
  'js/levels/loader.js', 'js/levels/level1.js', 'js/levels/level2.js', 'js/levels/level3.js', 'js/levels/generator.js',
  'js/engine/simulation.js', 'js/levels/campaign.js', 'js/ai/pathfinder.js', 'js/ai/ai.js'
];
for (const f of FILES) require(path.join(ROOT, f));
const NS = globalThis.Bidules;

/**
 * Joue une partie : `rules` est une liste de {when(b, sim) -> bool, skill, once}.
 * À chaque pas, chaque règle peut s'appliquer au premier Bidule qui la satisfait.
 */
function play(levelIndex, rules, maxTicks) {
  const sim = new NS.Simulation(NS.Loader.levels[levelIndex]);
  const fired = new Set();
  while (sim.status === 'running' && sim.tick < (maxTicks || sim.timeLimitTicks)) {
    rules.forEach((r, i) => {
      if (r.once !== false && fired.has(i)) return;
      if (r.after && sim.tick < r.after) return;
      for (const b of sim.bidules) {
        if (r.when(b, sim) && sim.canAssign(b, r.skill)) {
          sim.issue({ type: 'assign', id: b.id, skill: r.skill });
          fired.add(i);
          break;
        }
      }
    });
    sim.step();
  }
  return sim;
}
module.exports = { NS, play };
