/**
 * sprites.js
 * Tous les graphismes sont générés par le code : pas de fichier image.
 * Chaque sprite est dessiné à partir de cartes de pixels en texte (une lettre
 * = une couleur de la palette) puis rasterisé une fois dans un petit canvas.
 * Les Bidules ont une version tournée vers la droite et une vers la gauche.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  /** Palette des Bidules : armure turquoise, visière jaune, jambes sombres. */
  const PAL = {
    D: '#17303a',  // contour
    H: '#2e8fa3',  // casque
    h: '#8ee3f2',  // reflet du casque
    V: '#ffd23f',  // visière lumineuse
    O: '#ff8a1f',  // visière en alerte
    B: '#3fb6c9',  // plastron
    b: '#2a8a9b',  // ombre du plastron
    G: '#f08a24',  // bras / arme
    L: '#2b5f6b',  // jambes
    P: '#dfe7ea',  // acier de l'outil
    R: '#d98b4a'   // brique
  };

  const HEAD = ['..DDDD..', '.DHhhHD.', '.DHHVVD.', '.DHHVVD.'];
  const HEAD_FRONT = ['..DDDD..', '.DHhhHD.', '.DVVVVD.', '.DHHHHD.'];
  const TORSO = ['..DbbD..', '.DBBBBGG', '.DBbBBGG', '..DBBD..'];

  const LEGS = {
    stand: ['..L..L..', '.LL..LL.'],
    w0: ['..L..L..', '.LL..LL.'],
    w1: ['..LL.L..', '...L.LL.'],
    w2: ['...LL...', '...LL...'],
    w3: ['..L.LL..', '.LL.L...']
  };

  function frame(head, torso, legs) { return head.concat(torso, legs); }

  /** Dictionnaire nom -> carte de pixels (8x10), tournée vers la droite. */
  const MAPS = {
    walk0: frame(HEAD, TORSO, LEGS.w0),
    walk1: frame(HEAD, TORSO, LEGS.w1),
    walk2: frame(HEAD, TORSO, LEGS.w2),
    walk3: frame(HEAD, TORSO, LEGS.w3),
    stand: frame(HEAD, TORSO, LEGS.stand),
    fall: frame(HEAD, ['G.DbbD.G', 'GDBBBBDG', '.DBbBBD.', '..DBBD..'], ['..L..L..', '..L..L..']),
    dig0: frame(HEAD_FRONT, ['..DbbD..', '.GBBBBG.', 'G.BbBB.G', '..DBBD..'], LEGS.stand),
    dig1: frame(HEAD_FRONT, ['..DbbD..', 'G.BBBB.G', '.GBbBBG.', '..DBBD..'], LEGS.stand),
    mine0: frame(HEAD, ['..DbbD.P', '.DBBBBGP', '.DBbBBG.', '..DBBD..'], LEGS.stand),
    mine1: frame(HEAD, ['..DbbD..', '.DBBBBGG', '.DBbBBGP', '..DBBD..'], LEGS.stand),
    bash0: frame(HEAD, ['..DbbD..', '.DBBBBGP', '.DBbBBGG', '..DBBD..'], LEGS.w0),
    bash1: frame(HEAD, ['..DbbD..', '.DBBBBG.', '.DBbBBGP', '..DBBD..'], LEGS.w2),
    build0: frame(HEAD, ['..DbbD..', '.DBBBBGG', '.DBbBBRR', '..DBBD..'], LEGS.stand),
    build1: frame(HEAD, ['..DbbDRR', '.DBBBBGG', '.DBbBBD.', '..DBBD..'], LEGS.stand),
    block0: frame(HEAD_FRONT, ['..DbbD..', 'GGBBBBGG', '.DBbBBD.', '..DBBD..'], LEGS.stand),
    block1: frame(['..DDDD..', '.DHhhHD.', '.DOOOOD.', '.DHHHHD.'], ['..DbbD..', 'GGBBBBGG', '.DBbBBD.', '..DBBD..'], LEGS.stand)
  };

  /** Mini police 3x5 pour les chiffres du compte à rebours. */
  const DIGITS = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
    2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
    4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
    8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111']
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Rasterise une carte de pixels ; `flip` la retourne horizontalement. */
  function rasterize(map, flip) {
    const h = map.length, w = map[0].length;
    const c = makeCanvas(w, h), g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = map[y][flip ? w - 1 - x : x];
        if (ch === '.') continue;
        g.fillStyle = PAL[ch];
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const Sprites = {
    frames: {},          // nom -> {r, l}
    parachute: null,
    cactus: null,

    build() {
      for (const name of Object.keys(MAPS)) {
        this.frames[name] = { r: rasterize(MAPS[name], false), l: rasterize(MAPS[name], true) };
      }
      // Parachute : voile rouge et crème.
      const pm = ['....RRRRRR....', '..RRWRRRRWRR..', '.RRWRRRRRRWRR.', 'RRWRRRRRRRRWRR', 'D.D..D..D..D.D'];
      const pal = { R: '#e8553c', W: '#fff1d6', D: '#17303a' };
      const pc = makeCanvas(14, 5), pg = pc.getContext('2d');
      pm.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== '.') { pg.fillStyle = pal[ch]; pg.fillRect(x, y, 1, 1); }
      }));
      this.parachute = pc;
      // Cactus.
      const cc = makeCanvas(11, 16), cg = cc.getContext('2d');
      cg.fillStyle = '#2f6b3a'; cg.fillRect(4, 0, 3, 16); cg.fillRect(0, 6, 4, 2); cg.fillRect(0, 3, 2, 4); cg.fillRect(7, 8, 4, 2); cg.fillRect(9, 5, 2, 4);
      cg.fillStyle = '#4e9a55'; cg.fillRect(5, 0, 1, 16); cg.fillRect(0, 3, 1, 4); cg.fillRect(10, 5, 1, 4);
      this.cactus = cc;
    },

    /** Choisit l'image d'un Bidule selon son état et son horloge d'animation. */
    frameFor(b) {
      const t = b.t;
      switch (b.state) {
        case 'walk': return 'walk' + (Math.floor(t / 3) % 4);
        case 'fall': return 'fall';
        case 'dig': return 'dig' + (Math.floor(t / 6) % 2);
        case 'mine': return 'mine' + (Math.floor(t / 5) % 2);
        case 'bash': return 'bash' + (Math.floor(t / 4) % 2);
        case 'build':
          if (b.phase === 0) return t < 4 ? 'build0' : 'build1';
          if (b.phase === 2) return 'stand';
          return 'walk' + (Math.floor(t / 3) % 4);
        case 'block': return 'block' + (Math.floor(t / 14) % 2);
        default: return 'stand';
      }
    },

    /** Dessine un chiffre (compte à rebours) en blanc cerné de sombre. */
    drawDigit(ctx, n, x, y) {
      const rows = DIGITS[n] || DIGITS[0];
      ctx.fillStyle = '#17303a';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (rows[r][c] === '1') ctx.fillRect(x + c - 1, y + r - 1, 3, 3);
      }
      ctx.fillStyle = '#ffffff';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (rows[r][c] === '1') ctx.fillRect(x + c, y + r, 1, 1);
      }
    },

    /** Icône 16x16 d'une compétence pour la barre d'outils. */
    icon(skillId) {
      const c = makeCanvas(16, 16), g = c.getContext('2d');
      const name = { blocker: 'block0', builder: 'build1', digger: 'dig0', miner: 'mine0', basher: 'bash0', floater: 'fall', bomber: 'stand' }[skillId] || 'stand';
      g.drawImage(this.frames[name].r, 4, 5);
      if (skillId === 'floater') g.drawImage(this.parachute, 1, 0);
      if (skillId === 'bomber') {          // bombe ronde à mèche
        g.fillStyle = '#17303a'; g.fillRect(10, 8, 5, 5); g.fillRect(9, 9, 7, 3);
        g.fillStyle = '#ffd23f'; g.fillRect(13, 6, 1, 2); g.fillStyle = '#ff6a1a'; g.fillRect(14, 5, 1, 1);
      }
      if (skillId === 'builder') {         // marches
        g.fillStyle = '#d98b4a'; g.fillRect(1, 13, 4, 2); g.fillRect(5, 11, 4, 4);
      }
      if (skillId === 'digger') {          // flèche vers le bas
        g.fillStyle = '#e8b86a'; g.fillRect(7, 14, 2, 2); g.fillRect(6, 15, 4, 1);
      }
      return c;
    }
  };

  NS.Sprites = Sprites;
})(typeof window !== 'undefined' ? window : globalThis);
