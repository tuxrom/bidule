/**
 * Test navigateur des aides et des rediffusions (Playwright + Chromium requis) :
 *   node tests/browser-assist.js          (CHROMIUM_PATH=... pour un Chromium déjà installé)
 * Niveau 2 : tutoriel, bloqueur posé puis libéré, retour arrière, indice, bandeau de blocage, démonstration gagnée.
 * Niveau 1 gagné : rediffusion gardée et rejouée à l'identique, fantôme synchronisé, lien #replay=, défi du jour.
 */
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const log = (m) => console.log('OK', m);

  await page.goto(url + '?debloquer');
  // Niveau 2 : tutoriel, bloqueur libéré, retour arrière, blocage détecté, indice, démonstration.
  await page.click('[data-action=campaign]');
  await page.click('[data-action=play][data-arg="1"]');
  await ev(() => game.setSpeed(4));
  await page.waitForFunction(() => game.tutoShown.size > 0, null, { timeout: 30000 });
  assert.ok(await ev(() => game.hintShown.has(0) && game.skill === 'miner' && game.speed === 1), 'tutoriel : étape 1 montrée, mineur choisi');
  log('tutoriel niveau 2 : étape affichée, compétence présélectionnée, vitesse x1');
  // Bloqueur puis libération par un toucher.
  await page.waitForFunction(() => game.sim.bidules.some((x) => x.state === 'walk' && x.y < 210 && x.x < 140), null, { timeout: 30000 });
  await page.keyboard.press('p');
  const r = await ev(() => {
    const g = game, b = g.sim.bidules.find((x) => x.state === 'walk' && x.y < 210 && x.x < 140);
    g.selectSkillIndex(0);
    const rc = g.canvas.getBoundingClientRect();
    return { id: b.id, x: (b.x - g.cam.x) * g.cam.zoom + rc.left, y: (b.y - 5 - g.cam.y) * g.cam.zoom + rc.top };
  });
  await page.mouse.click(r.x, r.y);
  assert.strictEqual(await ev((id) => game.sim.bidules.find((b) => b.id === id).state, r.id), 'block');
  await ev(() => game.selectSkillIndex(1));   // bâtisseur : ne s'applique pas à un bloqueur -> libération
  const r2 = await ev((id) => { const g = game, b = g.sim.bidules.find((x) => x.id === id), rc = g.canvas.getBoundingClientRect(); g.sim.bidules.filter((x) => x.id !== id).forEach((x) => { x.x = 20; }); return { x: (b.x - g.cam.x) * g.cam.zoom + rc.left, y: (b.y - 5 - g.cam.y) * g.cam.zoom + rc.top }; }, r.id);
  await page.mouse.click(r2.x, r2.y);
  assert.strictEqual(await ev((id) => game.sim.bidules.find((b) => b.id === id).state, r.id), 'walk');
  log('bloqueur posé puis libéré d\'un toucher');
  await page.keyboard.press('p');
  await ev(() => game.setSpeed(4));
  await page.waitForFunction(() => game.sim.tick > 900, null, { timeout: 60000 });
  await ev(() => game.setPaused(true));
  const before = await ev(() => game.sim.tick);
  await page.keyboard.press('Backspace');
  const after = await ev(() => game.sim.tick);
  await ev(() => game.setPaused(false));
  assert.ok(before - after >= 150 && before - after <= 190, 'retour de 5 à 6 s : ' + before + ' -> ' + after);
  log('retour arrière : ' + before + ' -> ' + after);
  // Indice.
  await page.keyboard.press('i');
  assert.ok(await ev(() => game.hintsUsed === 1), 'indice compté');
  log('indice');
  // Blocage : on fige les Bidules (tous bloqueurs) -> bandeau.
  await ev(() => { const g = game; g.sim.players[0].released = g.sim.players[0].count; g.sim.bidules.forEach((b) => { b.state = 'block'; }); g.setSpeed(4); });
  await page.waitForFunction(() => !document.getElementById('assist').hidden, null, { timeout: 30000 });
  const btns = await ev(() => [...document.querySelectorAll('#assist [data-assist]')].map((b) => b.dataset.assist));
  assert.deepStrictEqual(btns, ['hint', 'rewind', 'kill', 'retry', 'close']);
  await page.click('#assist [data-assist=kill]');
  assert.ok(await ev(() => game.killMode && document.getElementById('assist').hidden));
  log('blocage détecté, bandeau d\'aide, Éliminer');
  // Démonstration depuis la pause.
  await page.keyboard.press('Escape');
  await page.click('[data-action=demo]');
  assert.strictEqual(await ev(() => game.kind), 'demo');
  await ev(() => game.setSpeed(4));
  await page.waitForFunction(() => game.sim.status !== 'running', null, { timeout: 120000 });
  await page.waitForSelector('[data-action=play-watched]', { timeout: 5000 });
  assert.strictEqual(await ev(() => game.sim.status), 'won');
  log('démonstration de la solution gagnée');

  // Partie gagnée -> rediffusion, fantôme, lien.
  await ev(() => { game.startCampaign(0); });
  await ev(() => { const g = game, def = g.sim.def, done = new Set(); g.driver = () => { for (const c of Bidules.Solver.play(g.sim, def.plan, done)) { const b = g.sim.bidules.find((x) => x.id === c.id); if (b) g.noteOrder(c.skill, b); } }; g.setSpeed(4); });
  await page.waitForSelector('[data-action=watch]', { timeout: 120000 });
  const saved = await ev(() => JSON.parse(localStorage.getItem('bidules.replays.v1'))['dunes-1']);
  assert.ok(saved.best && saved.last && saved.bestPct === 100);
  log('replay gardé (meilleur ' + saved.bestPct + '%)');
  await page.click('[data-action=watch]');
  assert.strictEqual(await ev(() => game.kind), 'replay');
  await ev(() => game.setSpeed(4));
  await page.waitForSelector('[data-action=play-watched]', { timeout: 120000 });
  assert.strictEqual(await ev(() => game.sim.players[0].saved), 20);
  log('rediffusion rejouée à l\'identique');
  await page.click('[data-action=play-watched]');
  assert.ok(await ev(() => game.kind === 'campaign' && !!game.ghost && game.ghostBidules() !== null));
  await page.waitForTimeout(3000);
  assert.ok(await ev(() => game.ghost.sim.tick === game.sim.tick));
  log('fantôme synchronisé');
  // Lien direct de replay.
  const code = await ev(() => game.lastReplay);
  await page.goto(url + '#replay=' + code);
  await page.waitForFunction(() => window.game && game.kind === 'replay', null, { timeout: 10000 });
  log('lien #replay= ouvre la rediffusion');
  // Défi du jour (hors ligne : pas de classement).
  await page.goto(url);
  await page.click('[data-action=daily]');
  await page.waitForSelector('#daily-board small');
  await page.click('[data-action=daily-play]');
  assert.strictEqual(await ev(() => game.kind), 'daily');
  assert.ok(await ev(() => /^Défi du/.test(game.sim.def.name)));
  log('défi du jour lancé : ' + await ev(() => game.sim.def.name));
  assert.deepStrictEqual(errors, [], errors.join('\n'));
  log('aucune erreur JS');
  await browser.close();
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
