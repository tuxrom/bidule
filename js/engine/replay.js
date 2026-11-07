/**
 * replay.js
 * Rediffusions. La simulation est déterministe : une partie solo se résume à « quel niveau » + le journal des
 * commandes appliquées (sim.log, déjà tronqué par les annulations). Quelques kilo-octets suffisent pour la revoir,
 * la partager par lien, la rejouer en fantôme ou la vérifier côté serveur (classement du défi du jour).
 *
 * Format : { v, p (version du protocole), ref, log: [[tick, type, ...champs]] }
 *   ref = { k: 'campaign', i } | { k: 'daily', d: 'AAAA-MM-JJ' } | { k: 'custom', c: code du niveau }
 * Aucune dépendance au DOM.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  // Champs conservés par type de commande, dans l'ordre (format compact).
  const FIELDS = {
    assign: ['id', 'skill'], dismiss: ['id'], release: ['id'], rate: ['value'],
    weapon: ['weapon', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'id', 'angle', 'power'],
    steer: ['x', 'y'], detonate: ['what']
  };
  const MAX_CMDS = 5000;

  const b64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64 = (s) => {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  const Replay = {
    /** Compacte le journal d'une simulation solo (joueur 0). */
    record(sim, ref) {
      const log = sim.log.filter((c) => (c.player | 0) === 0 && FIELDS[c.type]).map((c) => {
        const row = [c.tick, c.type];
        for (const f of FIELDS[c.type]) row.push(c[f] === undefined ? null : c[f]);
        while (row.length > 2 && row[row.length - 1] === null) row.pop();
        return row;
      });
      return { v: 1, p: NS.Net ? NS.Net.PROTOCOL : 0, ref, log };
    },

    /** Ligne compacte -> commande (bornée : un replay reçu d'un inconnu passe par l'assainissement du réseau). */
    command(row) {
      if (!Array.isArray(row) || !FIELDS[row[1]]) return null;
      const raw = { type: row[1] };
      FIELDS[row[1]].forEach((f, i) => { if (row[i + 2] !== null && row[i + 2] !== undefined) raw[f] = row[i + 2]; });
      const cmd = NS.Net ? NS.Net.sanitizeCommand(raw) : raw;
      if (!cmd) return null;
      cmd.tick = row[0] | 0;
      return cmd;
    },

    /** Niveau d'une référence (null si inconnue). */
    defOf(ref) {
      if (!ref) return null;
      if (ref.k === 'campaign') return NS.Campaign.all()[ref.i | 0] || null;
      if (ref.k === 'daily') return NS.Daily && NS.Daily.valid(ref.d) ? NS.Daily.def(ref.d) : null;
      if (ref.k === 'custom') { try { return NS.Loader.decodeLevel(ref.c); } catch (e) { return null; } }
      return null;
    },

    /** Lecteur : prépare la simulation et renvoie une fonction à appeler avant chaque sim.step(). */
    player(rep, def) {
      def = def || this.defOf(rep.ref);
      if (!def) throw new Error('niveau du replay introuvable');
      const cmds = (rep.log || []).slice(0, MAX_CMDS).map((r) => this.command(r)).filter(Boolean).sort((a, b) => a.tick - b.tick);
      const sim = new NS.Simulation(def);
      let i = 0;
      const feed = () => {
        while (i < cmds.length && cmds[i].tick < sim.tick) i++;            // commande périmée (replay altéré) : ignorée
        while (i < cmds.length && cmds[i].tick === sim.tick) { const c = Object.assign({}, cmds[i++]); c.player = 0; delete c.tick; sim.issue(c); }
      };
      return { sim, feed, def, total: cmds.length, get index() { return i; } };
    },

    /** Joue le replay jusqu'au bout (serveur, tests) ; renvoie le résultat. */
    run(rep, def) {
      const pl = this.player(rep, def), sim = pl.sim;
      while (sim.status === 'running') { pl.feed(); sim.step(); }
      return { status: sim.status, saved: sim.players[0].saved, count: sim.players[0].count, tick: sim.tick, hash: sim.hash(), sim };
    },

    encode(rep) { return b64(JSON.stringify(rep)); },
    decode(code) {
      const rep = JSON.parse(unb64(code));
      if (!rep || rep.v !== 1 || !rep.ref || !Array.isArray(rep.log)) throw new Error('replay invalide');
      return rep;
    }
  };

  NS.Replay = Replay;
})(typeof window !== 'undefined' ? window : globalThis);
