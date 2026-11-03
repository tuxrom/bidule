/**
 * lag-proxy.js : proxy TCP qui ajoute latence, gigue et perte de connexion entre un navigateur et le serveur.
 * Il retarde les octets sans les modifier (ordre conservé, comme sur un vrai TCP), donc il convient au WebSocket
 * comme au HTTP. Sert au plan de test de latence (docs/PLAN-DE-TEST.md).
 *
 *   node tools/lag-proxy.js --listen 3200 --target 3000 --latency 120 --jitter 40
 *   puis ouvrir http://localhost:3200 dans le navigateur.
 *   --cut 15   coupe toutes les connexions toutes les 15 s (test de reconnexion)
 */
const net = require('net');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const LISTEN = arg('listen', 3200), TARGET = arg('target', 3000), LAT = arg('latency', 100), JIT = arg('jitter', 30), CUT = arg('cut', 0);
const conns = new Set();

net.createServer((client) => {
  const upstream = net.connect(TARGET, '127.0.0.1');
  conns.add(client);
  const pipe = (from, to) => {
    let at = 0;                                          // instant de livraison du dernier bloc : jamais de dépassement
    from.on('data', (d) => {
      at = Math.max(at, Date.now() + LAT + Math.random() * JIT);
      setTimeout(() => { if (!to.destroyed) to.write(d); }, Math.max(0, at - Date.now()));
    });
    from.on('close', () => setTimeout(() => to.destroy(), LAT));
    from.on('error', () => {});
  };
  pipe(client, upstream); pipe(upstream, client);
  client.on('close', () => conns.delete(client));
}).listen(LISTEN, () => console.log(`proxy http://localhost:${LISTEN} -> :${TARGET}, latence ${LAT} ms (+0 à ${JIT} ms) par sens`));

if (CUT) setInterval(() => { console.log('coupure de', conns.size, 'connexion(s)'); for (const c of conns) c.destroy(); }, CUT * 1000);
