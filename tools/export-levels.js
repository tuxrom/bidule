/**
 * export-levels.js : écrit chaque niveau du jeu dans levels/<id>.json.
 * Ces fichiers sont identiques aux objets des js/levels/levelN.js et lisibles
 * par Loader.fromJSON() (chargement par fetch quand le jeu est servi en http,
 * futur éditeur de niveaux...). Usage : node tools/export-levels.js
 */
const fs = require('fs');
const path = require('path');
require('../tests/helpers');
const out = path.join(__dirname, '..', 'levels');
fs.mkdirSync(out, { recursive: true });
for (const def of globalThis.Bidules.Loader.levels) {
  fs.writeFileSync(path.join(out, def.id + '.json'), JSON.stringify(def, null, 2) + '\n');
  console.log('écrit', def.id + '.json');
}
