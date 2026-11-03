/**
 * Test de fumée dans un vrai navigateur (Playwright + Chromium requis) :
 *   node tests/browser-smoke.js
 * Ouvre index.html en file://, parcourt les menus et vérifie, sans erreur
 * levée : campagne (clic, raccourci AZERTY, annulation, zoom, mute), arsenal
 * (bouclier, canon visé à la carte, drone piloté), niveaux d'autres univers,
 * mode contre l'ordinateur jusqu'à l'écran de résultats.
 */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // --- Campagne : niveau 1 ---
  await page.goto(url);
  await page.click('[data-action=campaign]');
  assert.strictEqual(await ev(() => document.querySelectorAll('.lvl').length), 10);
  assert.strictEqual(await ev(() => document.querySelectorAll('.lvl.lock').length), 9, 'un seul niveau ouvert au départ');
  await page.click('[data-action=play][data-arg="0"]');
  await page.waitForTimeout(4500);
  assert.ok(await ev(() => document.getElementById('btn-tab').hidden), 'pas d\'arsenal au niveau 1');

  await page.keyboard.press('Digit3');                       // touche physique 3 sans Maj (AZERTY)
  assert.strictEqual(await ev(() => game.selected || game.skill), 'digger');
  await page.keyboard.press('p');
  const p = await ev(() => {
    const g = game, r = g.canvas.getBoundingClientRect(), b = g.sim.bidules.find((x) => x.state === 'walk');
    return { id: b.id, x: (b.x - g.cam.x) * g.cam.zoom + r.left, y: (b.y - 5 - g.cam.y) * g.cam.zoom + r.top };
  });
  await page.mouse.click(p.x, p.y);
  assert.strictEqual(await ev((id) => game.sim.bidules.find((b) => b.id === id).state, p.id), 'dig');
  await page.keyboard.press('u');
  assert.strictEqual(await ev((id) => game.sim.bidules.find((b) => b.id === id).state, p.id), 'walk');
  const z0 = await ev(() => game.cam.zoom);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  assert.notStrictEqual(await ev(() => game.cam.zoom), z0);
  await page.click('#btn-mute');
  assert.strictEqual(await ev(() => game.audio.muted), true);

  // --- Arsenal, dans un niveau de l'univers orbital (mode essai : tout est ouvert) ---
  await page.goto(url + '?debloquer');
  await ev(() => game.startCampaign(34));
  await page.waitForTimeout(3000);
  assert.strictEqual(await ev(() => document.body.dataset.theme), 'orbital');
  await page.keyboard.press('Tab');
  assert.strictEqual(await ev(() => game.tab), 'arms');
  assert.ok(await ev(() => document.querySelectorAll('.arm').length) >= 9);
  await ev(() => game.setPaused(true));
  await page.keyboard.press('Digit5');                       // bouclier
  const b0 = await ev(() => { const g = game, r = g.canvas.getBoundingClientRect(), b = g.sim.bidules[0]; return { x: (b.x - g.cam.x) * g.cam.zoom + r.left, y: (b.y - 5 - g.cam.y) * g.cam.zoom + r.top }; });
  await page.mouse.click(b0.x, b0.y);
  assert.strictEqual(await ev(() => game.sim.entities.filter((e) => e.kind === 'shield').length), 1);
  await page.keyboard.press('u');
  assert.strictEqual(await ev(() => game.sim.entities.length), 0, 'l\'annulation retire aussi les armes');
  await page.keyboard.press('Digit4');                       // canon
  assert.ok(await ev(() => !document.getElementById('aimpanel').hidden));
  await page.mouse.click(900, 300);
  await page.keyboard.press('Enter');
  assert.strictEqual(await ev(() => game.sim.entities.filter((e) => e.kind === 'shell').length), 1);
  await page.keyboard.press('Digit2');                       // drone kamikaze
  await ev(() => { game.sim.players[0].weapons.kdrone.cd = 0; });
  await page.mouse.click(700, 200);
  assert.strictEqual(await ev(() => game.sim.entities.filter((e) => e.kind === 'drone').length), 1);
  assert.ok(await ev(() => !document.getElementById('btn-boom').hidden), 'bouton Détoner affiché');

  // --- Contre l'ordinateur, jusqu'à l'écran de résultats ---
  await page.goto(url);
  await page.click('[data-action=versus]');
  await page.click('[data-action=vs][data-arg=medium]');
  assert.strictEqual(await ev(() => game.sim.mode), 'vs');
  await ev(() => { const g = game; let n = 0; while (g.sim.status === 'running' && n++ < 20000) { g.ai.update(); g.sim.step(); g.flushEvents(); } });
  await page.waitForTimeout(2200);
  assert.ok(await ev(() => document.querySelector('.stats') !== null), 'écran de résultats avec statistiques');
  assert.ok(await ev(() => game.sim.log.every((c) => c.player === 0 || c.player === 1)));

  assert.deepStrictEqual(errors, []);
  console.log('OK test de fumée navigateur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
