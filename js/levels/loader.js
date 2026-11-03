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

  const Loader = {
    MASK_PALETTE,

    /** Registre des niveaux fournis avec le jeu. */
    levels: [],
    register(def) { this.levels.push(def); },

    /** Lit un niveau depuis un texte JSON (fichier chargé par fetch, éditeur...). */
    fromJSON(text) { return JSON.parse(text); },

    /** Crée le terrain d'un niveau en exécutant ses opérations de dessin. */
    buildTerrain(def) {
      const t = new NS.Terrain(def.width, def.height);
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

    /** Applique une image de masque sur un terrain existant. */
    paintMask(terrain, imageData) { terrain.paintMask(imageData, MASK_PALETTE); }
  };

  NS.Loader = Loader;
})(typeof window !== 'undefined' ? window : globalThis);
