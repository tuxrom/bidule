/**
 * export-levels.js : écrit les niveaux au format JSON.
 *  - levels/<id>.json            : les trois niveaux écrits à la main (définitions d'origine) ;
 *  - levels/campagne/NN-<id>.json : les 40 niveaux de la campagne, avec armes, points et plan de solution ;
 *  - levels/versus-exemple.json  : une carte symétrique pour le mode contre l'ordinateur.
 * Ces fichiers sont lisibles par Loader.fromJSON() (chargement par fetch quand le jeu
 * est servi en http, futur éditeur de niveaux...). Usage : node tools/export-levels.js
 */
const fs = require('fs');
const path = require('path');
require('../tests/helpers');
const NS = globalThis.Bidules;
const out = path.join(__dirname, '..', 'levels');
fs.mkdirSync(path.join(out, 'campagne'), { recursive: true });
const write = (file, def) => { fs.writeFileSync(path.join(out, file), JSON.stringify(def) + '\n'); console.log('écrit', file); };
for (const def of NS.Loader.levels) write(def.id + '.json', def);
NS.Campaign.all().forEach((def, i) => write('campagne/' + String(i + 1).padStart(2, '0') + '-' + def.id + '.json', def));
write('versus-exemple.json', NS.Generator.buildVS({ id: 'vs-exemple', name: 'Duel', theme: 'desert', seed: 5, segments: 3, traps: 1, count: 24 }));
