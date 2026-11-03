/**
 * build-pwa.js : produit sw-assets.js, la liste des fichiers à mettre en cache et la version (empreinte de leur contenu).
 * À relancer après toute modification d'un fichier du jeu : `npm run build:pwa` (le test tests/pwa.test.js vérifie qu'elle est à jour).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

function assets() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const list = new Set(['./', 'index.html', 'manifest.webmanifest']);
  for (const m of html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css|png|webmanifest))"/g)) if (!/^https?:/.test(m[1])) list.add(m[1]);
  for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) list.add('icons/' + f);
  return [...list];
}

function build() {
  const files = assets();
  const h = crypto.createHash('sha1');
  for (const f of files) if (f !== './') h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  const version = h.digest('hex').slice(0, 10);
  const out = `/* Fichier généré par tools/build-pwa.js : ne pas modifier à la main. */\nself.VERSION = '${version}';\nself.ASSETS = ${JSON.stringify(files, null, 2)};\n`;
  return { out, version, files };
}

if (require.main === module) {
  const { out, version, files } = build();
  fs.writeFileSync(path.join(ROOT, 'sw-assets.js'), out);
  console.log(`sw-assets.js : ${files.length} fichiers, version ${version}`);
}
module.exports = { build, assets };
