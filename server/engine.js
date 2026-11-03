/** engine.js : charge UNE fois le moteur du jeu (le même code que les clients) dans le processus serveur. */
const path = require('path');
const FILES = require('./engine-files');
const ROOT = path.join(__dirname, '..');
let loaded = false;
module.exports = function load() {
  if (!loaded) { for (const f of FILES) require(path.join(ROOT, f)); loaded = true; }
  return globalThis.Bidules;
};
module.exports.ROOT = ROOT;
