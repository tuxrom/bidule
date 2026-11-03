/**
 * PWA : liste de précache à jour, manifeste et icônes valides ; puis (si Playwright est disponible) test dans un vrai
 * navigateur : installation du service worker, mise en cache, puis rechargement HORS LIGNE et partie jouable.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { build } = require('../tools/build-pwa');

// 1. sw-assets.js correspond au contenu actuel des fichiers.
const { out, files, version } = build();
assert.strictEqual(fs.readFileSync(path.join(ROOT, 'sw-assets.js'), 'utf8'), out, 'sw-assets.js périmé : lancer `npm run build:pwa`');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(files.includes(m[1]), m[1] + ' absent du précache');
assert.ok(files.includes('css/style.css') && files.includes('manifest.webmanifest') && files.includes('index.html'));
console.log('OK 1. précache à jour : ' + files.length + ' fichiers, version ' + version);

// 2. Manifeste et icônes.
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) assert.ok(man[k], 'manifeste : ' + k);
assert.ok(['standalone', 'fullscreen'].includes(man.display));
const sizeOf = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); assert.strictEqual(b.toString('latin1', 1, 4), 'PNG'); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
for (const i of man.icons) assert.strictEqual(sizeOf(i.src), i.sizes, i.src + ' : taille déclarée');
assert.ok(man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.purpose === 'maskable'));
console.log('OK 2. manifeste valide, icônes 192, 512 et maskable aux bonnes dimensions');

// 3. Navigateur réel.
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { console.log('(Playwright absent : test hors ligne ignoré)'); process.exit(0); }
const { server } = require('../server/server');
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('bidules-')), null, { timeout: 15000 });
  const cached = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find((k) => k.startsWith('bidules-'))); return (await c.keys()).length; });
  assert.ok(cached >= files.length - 1, 'tout est en cache : ' + cached);
  assert.strictEqual(await page.evaluate(() => document.querySelector('link[rel=manifest]') !== null), true);
  await page.reload();                                   // le service worker contrôle maintenant la page
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await ctx.setOffline(true);
  await page.reload();                                   // plus de réseau du tout
  await page.waitForFunction(() => window.game);
  await page.click('[data-action=campaign]');
  await page.click('[data-action=play][data-arg="0"]');
  await page.waitForTimeout(2500);
  assert.ok(await page.evaluate(() => game.sim.tick > 30 && game.sim.bidules.length > 0), 'la campagne se joue hors ligne');
  await page.evaluate(() => game.showTitle());
  await page.click('[data-action=versus]'); await page.click('[data-action=vs][data-arg=medium]');
  await page.waitForTimeout(1500);
  assert.ok(await page.evaluate(() => game.sim.mode === 'vs' && game.ai), 'le mode contre l\'ordinateur aussi');
  await page.evaluate(() => game.showTitle());
  await page.click('[data-action=editor]');
  assert.ok(await page.evaluate(() => !!document.getElementById('ed-canvas')), 'l\'éditeur aussi');
  await page.evaluate(() => game.showTitle());
  await page.click('[data-action=online]');
  await page.fill('#net-name', 'Hors ligne');
  assert.ok(/Hors ligne/.test(await page.textContent('#netstate')), 'le jeu en ligne signale qu\'il est indisponible');
  assert.deepStrictEqual(errors, []);
  console.log('OK 3. hors ligne : campagne, ordinateur et éditeur jouables, jeu en ligne signalé indisponible');
  await browser.close(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
