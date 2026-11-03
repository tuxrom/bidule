/**
 * make-icons.js : génère les icônes de la PWA (PNG) en dessinant le Bidule avec le vrai moteur de sprites,
 * dans un Chromium piloté par Playwright. Les PNG sont versionnés : ce script ne sert qu'à les refaire.
 *   node tools/make-icons.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.game);
  const render = (size, scale) => page.evaluate(({ size, scale }) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const sky = g.createLinearGradient(0, 0, 0, size); sky.addColorStop(0, '#3f86c2'); sky.addColorStop(0.6, '#f6d8a0'); sky.addColorStop(1, '#f2b676');
    g.fillStyle = sky; g.fillRect(0, 0, size, size);
    g.fillStyle = 'rgba(255,246,216,0.9)'; g.beginPath(); g.arc(size * 0.74, size * 0.28, size * 0.11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#cf8a58'; g.beginPath(); g.moveTo(0, size * 0.78); g.quadraticCurveTo(size * 0.3, size * 0.6, size * 0.6, size * 0.76); g.quadraticCurveTo(size * 0.85, size * 0.86, size, size * 0.72); g.lineTo(size, size); g.lineTo(0, size); g.fill();
    g.fillStyle = '#e8b86a'; g.fillRect(0, size * 0.84, size, size * 0.16);
    const sprite = Bidules.Sprites.frames[0].walk1.r, w = 8 * scale, h = 10 * scale;
    g.drawImage(sprite, Math.round((size - w) / 2), Math.round(size * 0.84 - h), w, h);
    return c.toDataURL('image/png');
  }, { size, scale });
  const save = async (name, size, scale) => {
    const url = await render(size, scale);
    fs.writeFileSync(path.join(__dirname, '..', 'icons', name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('écrit icons/' + name);
  };
  fs.mkdirSync(path.join(__dirname, '..', 'icons'), { recursive: true });
  await save('icon-192.png', 192, 11);
  await save('icon-512.png', 512, 30);
  await save('icon-maskable-512.png', 512, 22);      // contenu réduit : le masque d'Android rogne les bords
  await save('apple-touch-icon.png', 180, 10);
  await save('favicon-32.png', 32, 2);
  await browser.close();
})();
