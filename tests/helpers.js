/**
 * helpers.js - charge les modules du moteur sous Node, dans l'ordre d'index.html,
 * et fournit de quoi piloter une simulation avec un "robot" de test.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = require('../server/engine-files');
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
