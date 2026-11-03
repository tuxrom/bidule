/** Éditeur : codes de partage (aller-retour, bornes, refus des codes piégés) et API de publication du serveur. */
process.env.DATA_DIR = require('os').tmpdir() + '/bidules-test-' + process.pid;
const assert = require('assert');
const http = require('http');
const NS = require('../server/engine')();
const { server } = require('../server/server');
const L = NS.Loader;

// Aller-retour : le terrain d'un niveau survit au codage, la partie jouée est identique.
const t = new NS.Terrain(600, 300);
t.paintRect(0, 220, 600, 80, NS.M.SAND); t.paintRect(0, 0, 8, 300, NS.M.ROCK); t.paintEllipse(300, 150, 30, 20, NS.M.LAVA);
const def = { name: 'Mon niveau', width: 600, height: 300, theme: 'arctic', hatch: { x: 40, y: 150, dir: 1 }, exit: { x: 560, y: 219 }, count: 15, goal: 60, timeLimit: 200, skills: { builder: 5, basher: 2 } };
const code = L.encodeLevel(def, t);
assert.ok(code.length < 4000, 'un niveau typique tient en peu de caractères : ' + code.length);
assert.ok(/^[A-Za-z0-9_\-.]+$/.test(code), 'alphabet sûr (URL, presse-papiers)');
const back = L.decodeLevel(code);
assert.strictEqual(back.name, 'Mon niveau'); assert.strictEqual(back.theme, 'arctic'); assert.strictEqual(back.goal, 60); assert.strictEqual(back.skills.builder, 5);
const t2 = L.buildTerrain(back);
assert.strictEqual(t2.hash(), t.hash(), 'terrain identique');
const s1 = new NS.Simulation(back), s2 = new NS.Simulation(L.decodeLevel(code));
for (let i = 0; i < 300; i++) { s1.step(); s2.step(); }
assert.strictEqual(s1.hash(), s2.hash());
console.log('OK 1. code de niveau : aller-retour exact, ' + code.length + ' caractères');

// Bornes et codes hostiles.
const evil = (h, body) => Buffer.from(JSON.stringify(h)).toString('base64url') + '.' + body;
const body = L.encodeRLE(t.data);
const wild = L.decodeLevel(evil({ n: '<img src=x onerror=alert(1)>', w: 5, h: 99999, hx: -500, hy: 1e9, c: 1e6, g: 5000, t: -1, th: 'inconnu', s: { builder: 1e9, 'x': 1 } }, L.encodeRLE(new NS.Terrain(200, 600).data)));
assert.ok(wild.width === 200 && wild.height === 600 && wild.hatch.x >= 12 && wild.hatch.y <= 588 && wild.count === 60 && wild.goal === 100 && wild.timeLimit === 30 && wild.theme === 'desert' && wild.skills.builder === 20);
assert.ok(!/[<>"']/.test(wild.name), 'nom assaini');
assert.throws(() => L.decodeLevel(evil({ w: 600, h: 300 }, 'AAAA')), /invalide|incomplet|tronqué/);
assert.throws(() => L.decodeLevel(evil({ w: 600, h: 300 }, L.encodeRLE(new NS.Terrain(100, 100).data))), /incomplet/, 'taille de terrain incohérente');
assert.throws(() => L.decodeLevel('n importe quoi'), /./);
assert.throws(() => L.decodeLevel(evil({ w: 600, h: 300 }, Buffer.from([9, 5]).toString('base64url'))), /invalide/, 'matériau inconnu');
console.log('OK 2. codes hostiles : valeurs bornées, nom assaini, terrain incohérent ou matériau inconnu refusés');

// API de publication.
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (x) => d += x); res.on('end', () => { let b = null; try { b = d ? JSON.parse(d) : null; } catch (e) { b = d; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
server.listen(0, '127.0.0.1', async () => {
  const pub = await req('POST', '/api/levels', { code });
  assert.strictEqual(pub.status, 201); assert.ok(/^NIV[0-9A-F]{6}$/.test(pub.body.id));
  const got = await req('GET', '/api/levels/' + pub.body.id);
  assert.strictEqual(got.body.code, code);
  assert.strictEqual((await req('GET', '/api/levels/NIVZZZZZZ')).status, 404);
  assert.strictEqual((await req('POST', '/api/levels', { code: '<script>alert(1)</script>' })).status, 400, 'jamais de code arbitraire');
  assert.strictEqual((await req('POST', '/api/levels', { code: 'a'.repeat(70000) }).catch(() => ({ status: 413 }))).status >= 400, true, 'taille limitée (refus ou coupure)');
  assert.strictEqual((await req('GET', '/server/rooms.js')).status, 404, 'les sources du serveur ne sont pas publiques');
  assert.strictEqual((await req('GET', '/../package.json')).status, 404);
  assert.strictEqual((await req('GET', '/%2e%2e/package.json')).status, 404);
  console.log('OK 3. API : publication, relecture, refus des contenus invalides, fichiers privés introuvables');
  server.close(); process.exit(0);
});
