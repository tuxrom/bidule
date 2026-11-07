/**
 * netdef.js
 * Tout ce que le serveur et les clients doivent calculer À L'IDENTIQUE : version du protocole, construction de
 * la partie depuis sa configuration, assainissement et autorisation des commandes, rôles du mode coopératif,
 * codes d'emojis. Ce fichier est chargé par index.html ET par le serveur Node.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  /** Incrémenté à chaque changement de règles ou de protocole : un client d'une autre version est refusé. */
  const PROTOCOL = 2;          // 2 : commande « dismiss » (éliminer un Bidule)
  const BUILD = '1.1.0';
  const TURN = 3;                 // pas de simulation par message `step` (100 ms)
  const HASH_EVERY = 60;          // somme de contrôle toutes les 2 s de jeu
  const DELAY_MIN = 3, DELAY_MAX = 15;   // délai d'entrée, en pas (100 ms à 500 ms)

  /** Chat rapide : des codes, jamais du texte libre (pas de modération à faire, pas d'injection possible). */
  const EMOJIS = { gg: '👍', nice: '👏', oops: '😅', wow: '😮', angry: '😡', think: '🤔', fire: '🔥', flag: '🏳️' };

  /** Mode coopératif : répartition des compétences et des armes entre les deux joueurs d'une même armée. */
  const COOP_ROLES = [
    { name: 'Ingénieur', skills: ['builder', 'blocker', 'climber', 'floater'], weapons: ['recon', 'shield', 'zipline', 'jetpack', 'grapple', 'tank'], remote: false },
    { name: 'Démolisseur', skills: ['digger', 'miner', 'basher', 'bomber'], weapons: ['kdrone', 'cannon', 'satellite', 'mine'], remote: true }
  ];

  /** Configuration par défaut d'un salon. */
  function defaultSettings(mode) {
    return mode === 'coop' ? { level: 0 } : { segments: 3, theme: 'desert', traps: 1 };
  }

  /** Assainit les réglages envoyés par l'hôte (jamais de confiance dans le réseau). */
  function sanitizeSettings(mode, raw) {
    raw = raw || {};
    const int = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
    if (mode === 'coop') return { level: int(raw.level, 0, 39, 0) };
    const themes = ['desert', 'ruins', 'arctic', 'orbital'];
    return { segments: int(raw.segments, 2, 5, 3), theme: themes.includes(raw.theme) ? raw.theme : 'desert', traps: int(raw.traps, 0, 2, 1) };
  }

  /** Construit le niveau d'une partie. Même résultat chez tous les participants (le générateur est déterministe). */
  function buildDef(config) {
    if (config.mode === 'coop') {
      const def = JSON.parse(JSON.stringify(NS.Campaign.all()[config.level]));
      def.id = 'coop-' + def.id;
      return def;
    }
    return NS.Generator.buildVS({ id: 'net-' + config.seed, name: 'Duel en ligne', theme: config.theme, seed: config.seed, segments: config.segments, traps: config.traps, count: 24 });
  }

  const int = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);

  /**
   * Assainit une commande reçue d'un client : types connus, champs bornés, rien d'autre. Renvoie une commande propre
   * (sans `tick`, `player`, `by` : c'est le serveur qui les pose) ou null.
   */
  function sanitizeCommand(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const W = 4000, H = 1200;
    switch (raw.type) {
      case 'assign': {
        const id = int(raw.id, 1, 1e6);
        return id && typeof raw.skill === 'string' && NS.Skills.byId[raw.skill] ? { type: 'assign', id, skill: raw.skill } : null;
      }
      case 'dismiss': { const id = int(raw.id, 1, 1e6); return id ? { type: 'dismiss', id } : null; }
      case 'rate': { const v = int(raw.value, 1, 99); return v ? { type: 'rate', value: v } : null; }
      case 'weapon': {
        if (typeof raw.weapon !== 'string' || !NS.Weapons.byId[raw.weapon]) return null;
        const c = { type: 'weapon', weapon: raw.weapon };
        for (const k of ['x', 'y', 'x1', 'x2', 'y1', 'y2']) if (raw[k] !== undefined) { const v = int(raw[k], -50, W); if (v === null) return null; c[k] = v; }
        if (raw.id !== undefined) { const v = int(raw.id, 1, 1e6); if (v === null) return null; c.id = v; }
        for (const [k, lo, hi] of [['angle', 0, 90], ['power', 0, 100]]) if (raw[k] !== undefined) { const v = int(raw[k], lo, hi); if (v === null) return null; c[k] = v; }
        return c;
      }
      case 'steer': {
        const x = int(raw.x, 0, W), y = int(raw.y, 0, H);
        return x === null || y === null ? null : { type: 'steer', x, y };
      }
      case 'detonate': return { type: 'detonate', what: raw.what === 'mine' || raw.what === 'drone' ? raw.what : undefined };
    }
    return null;
  }

  /**
   * Un joueur a-t-il le droit d'émettre cette commande ?
   * En duel : toujours (sa propre armée). En coop : selon son rôle, sauf si son partenaire est parti (il a alors tout).
   */
  function allowed(cmd, mode, slot, partnerPresent) {
    if (mode !== 'coop' || !partnerPresent) return true;
    const role = COOP_ROLES[slot];
    if (cmd.type === 'assign') return role.skills.includes(cmd.skill);
    if (cmd.type === 'weapon') return role.weapons.includes(cmd.weapon);
    if (cmd.type === 'steer' || cmd.type === 'detonate') return role.remote;
    return true;
  }

  /** Délai d'entrée adapté à la latence : demi-RTT du pire joueur, deux fois la gigue, 40 ms de marge. */
  function adaptiveDelay(rttMs, jitterMs) {
    const ms = rttMs / 2 + 2 * jitterMs + 40;
    return Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.ceil(ms / (1000 / NS.C.TICK_RATE))));
  }

  NS.Net = { PROTOCOL, BUILD, TURN, HASH_EVERY, DELAY_MIN, DELAY_MAX, EMOJIS, COOP_ROLES, defaultSettings, sanitizeSettings, buildDef, sanitizeCommand, allowed, adaptiveDelay };
})(typeof window !== 'undefined' ? window : globalThis);
