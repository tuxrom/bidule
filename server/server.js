/**
 * server.js : serveur HTTP statique + WebSocket + API de partage de niveaux.
 *   npm start            -> http://localhost:3000   (PORT, HOST, DATA_DIR, ALLOWED_ORIGINS en variables d'environnement)
 * Le même processus sert le jeu (fichiers statiques) et le multijoueur (/ws). Derrière Nginx ou une plateforme
 * à HTTPS, le navigateur utilise wss:// automatiquement (voir docs/DEPLOIEMENT.md).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Manager } = require('./rooms');
const ROOT = require('./engine').ROOT;

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_LEVEL_BYTES = 64 * 1024;
const MAX_LEVELS = 5000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// Seuls ces fichiers sont publics : jamais server/, tests/, node_modules/, data/.
const PUBLIC_DIRS = ['css', 'js', 'icons', 'levels'];
const PUBLIC_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'sw-assets.js', 'favicon.ico']);

/* ------------------------------ Niveaux partagés ------------------------------ */

const levels = new Map();
const levelFile = path.join(DATA_DIR, 'levels.json');
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(levelFile, 'utf8')))) levels.set(k, v); } catch (e) { /* premier démarrage */ }
let saveTimer = null;
function saveLevels() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(levelFile, JSON.stringify(Object.fromEntries(levels))); } catch (e) { console.error('sauvegarde des niveaux impossible', e.message); }
  }, 500);
}

/** Un niveau partagé est une chaîne opaque (voir Loader.encodeLevel) : on ne stocke que du texte borné, jamais de code. */
function validLevelCode(s) { return typeof s === 'string' && s.length > 10 && s.length <= MAX_LEVEL_BYTES && /^[A-Za-z0-9_\-.]+$/.test(s); }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('trop gros')); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

const postTimes = new Map();                            // limitation de débit des publications, par IP
function allowPost(ip) {
  const t = Date.now(), l = (postTimes.get(ip) || []).filter((x) => t - x < 60000);
  if (l.length >= 10) return false;
  l.push(t); postTimes.set(ip, l);
  return true;
}

/* --------------------------------- HTTP --------------------------------- */

const manager = new Manager();

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/healthz') return sendJSON(res, 200, Object.assign({ ok: true }, manager.stats()));
    if (p === '/api/levels' && req.method === 'POST') {
      if (Number(req.headers['content-length']) > MAX_LEVEL_BYTES + 100) { req.resume(); return sendJSON(res, 413, { error: 'niveau trop gros' }); }
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      if (!allowPost(String(ip))) return sendJSON(res, 429, { error: 'trop de publications' });
      const body = JSON.parse(await readBody(req, MAX_LEVEL_BYTES + 100));
      if (!validLevelCode(body.code)) return sendJSON(res, 400, { error: 'code de niveau invalide' });
      if (levels.size >= MAX_LEVELS) return sendJSON(res, 507, { error: 'stockage plein' });
      const id = 'NIV' + crypto.randomBytes(3).toString('hex').toUpperCase();
      levels.set(id, body.code); saveLevels();
      return sendJSON(res, 201, { id });
    }
    const m = /^\/api\/levels\/([A-Z0-9]{3,12})$/.exec(p);
    if (m && req.method === 'GET') return levels.has(m[1]) ? sendJSON(res, 200, { id: m[1], code: levels.get(m[1]) }) : sendJSON(res, 404, { error: 'introuvable' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    // Fichiers statiques.
    let rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const top = rel.split('/')[0];
    if (!PUBLIC_FILES.has(rel) && !PUBLIC_DIRS.includes(top)) { res.writeHead(404); return res.end('Introuvable'); }
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Introuvable'); }
      // Le service worker et la page d'accueil ne doivent jamais être servis périmés ; le reste est revalidé.
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  } catch (e) { sendJSON(res, 400, { error: 'requête invalide' }); }
});

/* ------------------------------- WebSocket ------------------------------- */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, verifyClient: (info) => !ORIGINS.length || ORIGINS.includes(info.origin) });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  manager.attach(ws);
});
// Battement de cœur : un socket muet pendant 40 s est coupé (le joueur pourra se reconnecter avec son jeton).
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) { /* fermé */ } } }, 20000).unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Opération Mirage : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (WebSocket sur /ws)`));
}
module.exports = { server, manager };
