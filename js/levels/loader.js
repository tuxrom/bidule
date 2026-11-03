/**
 * loader.js
 * Transforme la description JSON d'un niveau en terrain jouable.
 *
 * Format d'un niveau (tout est optionnel sauf width, height, hatch, exit, count) :
 * {
 *   "id": "dunes-1", "name": "Premiers pas", "hint": "texte d'aide",
 *   "width": 1200, "height": 480, "seed": 1234,
 *   "hatch": {"x": 100, "y": 300, "dir": 1},      // trappe d'entrée
 *   "exit":  {"x": 1050, "y": 339},               // pieds d'un Bidule posé sur la porte
 *   "count": 30,                                  // Bidules à lâcher
 *   "goal": 60,                                   // % à sauver
 *   "timeLimit": 300,                             // secondes
 *   "rate": {"min": 20, "start": 50},             // cadence de la trappe (1..99)
 *   "skills": {"builder": 3, "basher": 2},        // stocks de compétences
 *   "decor": [{"type": "cactus", "x": 200, "y": 340}],
 *   "terrain": [ opérations de dessin, dans l'ordre ]
 * }
 *
 * Opérations de terrain ("m" = sand | rock | brick | water | lava | air) :
 *   {"op":"rect",    "m":"sand", "x":0, "y":340, "w":400, "h":140}
 *   {"op":"ellipse", "m":"sand", "cx":..., "cy":..., "rx":..., "ry":...}
 *   {"op":"poly",    "m":"sand", "pts":[[x,y],[x,y],...]}
 *   {"op":"heights", "m":"sand", "pts":[[x,haut],[x,haut],...]}   // profil rempli vers le bas
 *
 * Variante "image de masque" : `Loader.paintMask(terrain, imageData)` convertit
 * une image dont les couleurs suivent MASK_PALETTE.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const M = NS.M;

  const MATERIAL_BY_NAME = { air: M.AIR, sand: M.SAND, rock: M.ROCK, brick: M.BRICK, water: M.WATER, lava: M.LAVA };

  /** Palette de l'image de masque : couleur RVB -> matériau. */
  const MASK_PALETTE = {
    0xd9a441: M.SAND,   // ocre
    0x6b3f3a: M.ROCK,   // brun sombre
    0xb5532a: M.BRICK,  // brique
    0x2d7fd6: M.WATER,  // bleu
    0xff6a1a: M.LAVA    // orange
  };

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = (s) => { const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  const hash32 = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

  const Loader = {
    MASK_PALETTE,

    /** Registre des niveaux fournis avec le jeu. */
    levels: [],
    register(def) { this.levels.push(def); },

    /**
     * Liste des configurations de joueurs d'un niveau. Un niveau solo décrit
     * son unique joueur à la racine (hatch, exit, count...) ; un niveau
     * « contre l'ordinateur » fournit `players: [...]`, chaque entrée
     * héritant des champs racine qu'elle ne redéfinit pas.
     */
    playersOf(def) {
      const base = { hatch: def.hatch, exit: def.exit, count: def.count, goal: def.goal, skills: def.skills,
        weapons: def.weapons, points: def.points, rate: def.rate, cannon: def.cannon };
      if (!def.players) return [base];
      return def.players.map((p) => Object.assign({}, base, p));
    },

    /** Lit un niveau depuis un texte JSON (fichier chargé par fetch, éditeur...). */
    fromJSON(text) { return JSON.parse(text); },

    /** Crée le terrain d'un niveau : bitmap RLE (niveaux de l'éditeur) ou opérations de dessin. */
    buildTerrain(def) {
      const t = new NS.Terrain(def.width, def.height);
      if (def.bitmap) { t.data.set(Loader.decodeRLE(def.bitmap, def.width * def.height)); t.markAllDirty(); return t; }
      for (const op of def.terrain || []) {
        const m = MATERIAL_BY_NAME[op.m];
        if (m === undefined) throw new Error('Matériau inconnu : ' + op.m);
        switch (op.op) {
          case 'rect': t.paintRect(op.x, op.y, op.w, op.h, m); break;
          case 'ellipse': t.paintEllipse(op.cx, op.cy, op.rx, op.ry, m); break;
          case 'poly': t.paintPoly(op.pts, m); break;
          case 'heights': t.paintHeights(op.pts, m, op.bottom); break;
          default: throw new Error('Opération inconnue : ' + op.op);
        }
      }
      t.markAllDirty();
      return t;
    },

    /* -------------------- Partage de niveaux par code (éditeur) -------------------- */

    /** Terrain -> chaîne base64url : suite de (matériau, longueur de série en varint). */
    encodeRLE(data) {
      const out = [];
      for (let i = 0; i < data.length;) {
        let j = i; while (j < data.length && data[j] === data[i]) j++;
        out.push(data[i]);
        for (let n = j - i; ; n >>= 7) { if (n < 128) { out.push(n); break; } out.push((n & 127) | 128); }
        i = j;
      }
      return b64(Uint8Array.from(out));
    },

    /** Chaîne -> terrain ; `len` est la taille exigée (refus de tout code qui ne la remplit pas exactement). */
    decodeRLE(str, len) {
      const bytes = unb64(str), data = new Uint8Array(len);
      let pos = 0;
      for (let i = 0; i < bytes.length;) {
        const m = bytes[i++];
        let n = 0, shift = 0, b;
        do { if (i >= bytes.length) throw new Error('code tronqué'); b = bytes[i++]; n |= (b & 127) << shift; shift += 7; } while (b & 128);
        if (m > 5 || n <= 0 || pos + n > len) throw new Error('code invalide');
        data.fill(m, pos, pos + n); pos += n;
      }
      if (pos !== len) throw new Error('code incomplet');
      return data;
    },

    /** Niveau de l'éditeur -> code partageable (en-tête JSON + terrain, séparés par un point). */
    encodeLevel(def, terrain) {
      const h = { v: 1, n: def.name, w: def.width, h: def.height, th: def.theme, hx: def.hatch.x, hy: def.hatch.y, hd: def.hatch.dir, ex: def.exit.x, ey: def.exit.y,
        c: def.count, g: def.goal, t: def.timeLimit, s: def.skills };
      return b64(new TextEncoder().encode(JSON.stringify(h))) + '.' + Loader.encodeRLE(terrain.data);
    },

    /**
     * Code -> niveau jouable. Tout est borné : un code venu d'un inconnu ne peut ni dépasser les limites, ni
     * placer la trappe hors carte, ni contenir autre chose que du terrain (aucune opération, aucun script).
     */
    decodeLevel(code) {
      const [hp, bp] = String(code).trim().split('.');
      if (!hp || !bp) throw new Error('code invalide');
      const h = JSON.parse(new TextDecoder().decode(unb64(hp)));
      const int = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
      const w = int(h.w, 200, 1200, 600), ht = int(h.h, 150, 600, 300);
      const skills = {};
      for (const k of ['blocker', 'builder', 'digger', 'miner', 'basher', 'floater', 'climber', 'bomber']) skills[k] = int(h.s && h.s[k], 0, 20, 0);
      const def = {
        id: 'custom-' + hash32(code), name: String(h.n || 'Niveau perso').replace(/[<>&"']/g, '').slice(0, 30), world: 'custom',
        theme: ['desert', 'ruins', 'arctic', 'orbital'].includes(h.th) ? h.th : 'desert',
        width: w, height: ht, seed: 4242, mode: 'solo',
        hatch: { x: int(h.hx, 12, w - 12, 40), y: int(h.hy, 12, ht - 12, 40), dir: h.hd === -1 ? -1 : 1 },
        exit: { x: int(h.ex, 12, w - 12, w - 40), y: int(h.ey, 12, ht - 2, ht - 40) },
        count: int(h.c, 1, 60, 20), goal: int(h.g, 1, 100, 50), timeLimit: int(h.t, 30, 900, 240),
        skills, rate: { min: 20, start: 40 }, bitmap: bp
      };
      def.bitmap = Loader.encodeRLE(Loader.decodeRLE(bp, w * ht));       // re-normalisé et validé
      return def;
    },

    /** Applique une image de masque sur un terrain existant. */
    paintMask(terrain, imageData) { terrain.paintMask(imageData, MASK_PALETTE); }
  };

  NS.Loader = Loader;
})(typeof window !== 'undefined' ? window : globalThis);
