/**
 * Test de fumée dans un vrai navigateur (Playwright + Chromium requis) :
 *   node tests/browser-smoke.js
 * Ouvre index.html en file://, lance le niveau 1, vérifie qu'aucune erreur
 * n'est levée et que clic, raccourci AZERTY, annulation, zoom et mute fonctionnent.
 */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.click('[data-action=levels]');
  await page.click('[data-action=play][data-arg="0"]');
  await page.waitForTimeout(4500);

  await page.keyboard.press('Digit3');                       // touche physique 3, sans Maj (AZERTY)
  assert.strictEqual(await page.evaluate(() => game.selected), 'digger');
  await page.keyboard.press('p');
  const p = await page.evaluate(() => {
    const g = game, r = g.canvas.getBoundingClientRect(), b = g.sim.bidules.find((x) => x.state === 'walk');
    return { id: b.id, x: (b.x - g.cam.x) * g.cam.zoom + r.left, y: (b.y - 5 - g.cam.y) * g.cam.zoom + r.top };
  });
  await page.mouse.click(p.x, p.y);
  assert.strictEqual(await page.evaluate((id) => game.sim.bidules.find((b) => b.id === id).state, p.id), 'dig');
  await page.keyboard.press('u');
  assert.strictEqual(await page.evaluate((id) => game.sim.bidules.find((b) => b.id === id).state, p.id), 'walk');

  const z0 = await page.evaluate(() => game.cam.zoom);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  assert.notStrictEqual(await page.evaluate(() => game.cam.zoom), z0);

  await page.click('#btn-mute');
  assert.strictEqual(await page.evaluate(() => game.audio.muted), true);
  assert.deepStrictEqual(errors, []);
  console.log('OK test de fumée navigateur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
