/**
 * themes.js
 * Un thème par univers : palette du terrain, ciel, couches d'arrière-plan,
 * décor. Le moteur de rendu les lit à chaque changement de niveau ; rien
 * d'autre ne dépend de l'univers. Couleurs en [r, g, b].
 *
 *   desert  : dunes ocre, montagnes mauves, cactus
 *   ruins   : béton fissuré, ciel poussiéreux, silhouettes d'immeubles, pylônes
 *   arctic  : neige et glace, ciel pâle, montagnes bleutées, sapins
 *   orbital : plaques métalliques, vide étoilé, planète, antennes
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  /** Variantes d'une couleur de base (légères variations de grain). */
  const shades = (r, g, b) => [[r, g, b], [r - 8, g - 9, b - 10], [r - 18, g - 20, b - 20], [r + 6, g + 7, b + 8]];

  const THEMES = {
    desert: {
      name: 'Désert des mirages',
      sky: [[0, '#3f86c2'], [0.5, '#a9cde0'], [0.75, '#f6d8a0'], [1, '#f2b676']],
      stars: 0, sun: { x: 0.8, y: 0.2, glow: [255, 240, 200], r: 22 },
      layers: [
        { f: 0.15, base: 0.50, amp: 46, col: '#b79bb0', kind: 'peaks' },
        { f: 0.30, base: 0.62, amp: 26, col: '#e0a47a', kind: 'dunes' },
        { f: 0.55, base: 0.74, amp: 18, col: '#cf8a58', kind: 'dunes' }
      ],
      ground: { base: shades(232, 184, 106), band: shades(214, 160, 88), top: [250, 218, 148], low: [176, 126, 64] },
      rock: { base: shades(112, 74, 72), top: [158, 112, 100], low: [68, 42, 48] },
      brick: [[204, 114, 62], [150, 80, 46], [238, 160, 100]],
      brickB: [[70, 120, 205], [40, 70, 130], [140, 180, 245]],
      water: { base: shades(46, 125, 214), top: [150, 208, 252] },
      lava: { base: shades(255, 106, 26), top: [255, 232, 128] },
      cave: { base: shades(128, 90, 62), shade: [92, 63, 44] },
      bg: '#f2b676', accent: '#ffd23f', fogTint: 'rgba(40,24,16,0.60)'
    },
    ruins: {
      name: 'Ville en ruines',
      sky: [[0, '#4a4252'], [0.45, '#8c7378'], [0.8, '#d9a07a'], [1, '#e8b88a']],
      stars: 0, sun: { x: 0.25, y: 0.3, glow: [255, 190, 140], r: 26 },
      layers: [
        { f: 0.12, base: 0.58, amp: 90, col: '#6e5a6a', kind: 'city' },
        { f: 0.30, base: 0.66, amp: 60, col: '#5a4a5a', kind: 'city' },
        { f: 0.55, base: 0.78, amp: 30, col: '#463a48', kind: 'city' }
      ],
      ground: { base: shades(150, 142, 132), band: shades(132, 124, 116), top: [196, 188, 176], low: [96, 90, 84] },
      rock: { base: shades(70, 74, 86), top: [120, 126, 140], low: [36, 38, 48] },
      brick: [[190, 96, 60], [124, 62, 42], [232, 142, 98]],
      brickB: [[70, 120, 205], [40, 70, 130], [140, 180, 245]],
      water: { base: shades(60, 104, 96), top: [150, 200, 180] },
      lava: { base: shades(240, 90, 30), top: [255, 220, 120] },
      cave: { base: shades(88, 82, 80), shade: [58, 54, 54] },
      bg: '#463a48', accent: '#ffb347', fogTint: 'rgba(20,16,24,0.64)'
    },
    arctic: {
      name: 'Base arctique',
      sky: [[0, '#2b4a7a'], [0.45, '#7fb0d8'], [0.8, '#d6ecf8'], [1, '#eef7fc']],
      stars: 0, sun: { x: 0.7, y: 0.22, glow: [235, 245, 255], r: 18 },
      aurora: true,
      layers: [
        { f: 0.15, base: 0.50, amp: 60, col: '#a9c4de', kind: 'peaks' },
        { f: 0.32, base: 0.63, amp: 34, col: '#cfe0ee', kind: 'peaks' },
        { f: 0.55, base: 0.76, amp: 18, col: '#e6f0f8', kind: 'dunes' }
      ],
      ground: { base: shades(236, 244, 250), band: shades(214, 228, 240), top: [255, 255, 255], low: [150, 176, 204] },
      rock: { base: shades(78, 94, 120), top: [136, 156, 184], low: [40, 50, 70] },
      brick: [[96, 170, 220], [56, 110, 160], [170, 226, 252]],
      brickB: [[225, 90, 80], [140, 50, 46], [255, 160, 150]],
      water: { base: shades(30, 120, 170), top: [180, 236, 255] },
      lava: { base: shades(255, 120, 40), top: [255, 236, 150] },
      cave: { base: shades(110, 130, 158), shade: [74, 90, 116] },
      bg: '#eef7fc', accent: '#8ee3f2', fogTint: 'rgba(10,24,48,0.60)'
    },
    orbital: {
      name: 'Station orbitale',
      sky: [[0, '#04050e'], [0.6, '#0b1030'], [1, '#1a1f48']],
      stars: 140, sun: { x: 0.18, y: 0.2, glow: [255, 235, 200], r: 0 }, planet: true,
      layers: [
        { f: 0.10, base: 0.60, amp: 70, col: '#171c3c', kind: 'modules' },
        { f: 0.28, base: 0.70, amp: 48, col: '#1f2650', kind: 'modules' },
        { f: 0.50, base: 0.80, amp: 28, col: '#2a3262', kind: 'modules' }
      ],
      ground: { base: shades(126, 138, 160), band: shades(108, 120, 144), top: [196, 214, 238], low: [64, 72, 94] },
      rock: { base: shades(48, 52, 72), top: [96, 104, 132], low: [22, 24, 36] },
      brick: [[88, 200, 220], [44, 120, 140], [170, 244, 255]],
      brickB: [[235, 90, 120], [140, 40, 70], [255, 160, 180]],
      water: { base: shades(40, 190, 210), top: [190, 255, 255] },
      lava: { base: shades(220, 60, 200), top: [255, 190, 255] },
      cave: { base: shades(36, 40, 58), shade: [20, 22, 34] },
      bg: '#04050e', accent: '#6df0ff', fogTint: 'rgba(0,0,12,0.66)'
    }
  };

  /** Dessine un élément de décor (canvas pré-rendu au chargement). */
  function makeDecor(type, make) {
    const draw = {
      cactus(g) {
        g.fillStyle = '#2f6b3a'; g.fillRect(4, 0, 3, 16); g.fillRect(0, 6, 4, 2); g.fillRect(0, 3, 2, 4); g.fillRect(7, 8, 4, 2); g.fillRect(9, 5, 2, 4);
        g.fillStyle = '#4e9a55'; g.fillRect(5, 0, 1, 16); g.fillRect(0, 3, 1, 4); g.fillRect(10, 5, 1, 4);
      },
      pylon(g) {            // pilier de béton cassé, ferraille apparente
        g.fillStyle = '#6b6560'; g.fillRect(2, 6, 8, 14); g.fillRect(3, 3, 5, 4);
        g.fillStyle = '#8a837c'; g.fillRect(2, 6, 2, 14);
        g.fillStyle = '#3a3633'; g.fillRect(6, 10, 1, 10); g.fillRect(8, 7, 1, 3);
        g.fillStyle = '#b5532a'; g.fillRect(4, 0, 1, 4); g.fillRect(7, 1, 1, 3);
      },
      pine(g) {             // sapin enneigé
        g.fillStyle = '#4a3a2e'; g.fillRect(6, 14, 2, 4);
        g.fillStyle = '#2b5a4a'; g.fillRect(5, 10, 4, 4); g.fillRect(3, 11, 8, 3); g.fillRect(4, 6, 6, 4); g.fillRect(5, 2, 4, 4); g.fillRect(6, 0, 2, 2);
        g.fillStyle = '#eaf4fa'; g.fillRect(4, 6, 2, 1); g.fillRect(5, 2, 2, 1); g.fillRect(3, 11, 2, 1); g.fillRect(8, 10, 2, 1);
      },
      antenna(g) {          // antenne de station avec feu clignotant (statique ici)
        g.fillStyle = '#8c98b4'; g.fillRect(5, 4, 2, 16); g.fillRect(2, 8, 8, 1); g.fillRect(3, 5, 6, 1);
        g.fillStyle = '#4a5472'; g.fillRect(4, 18, 4, 2);
        g.fillStyle = '#ff5a7a'; g.fillRect(5, 2, 2, 2);
      }
    }[type] || (() => {});
    const c = make(12, 20), g = c.getContext('2d');
    draw(g);
    return c;
  }

  NS.Themes = { all: THEMES, get: (name) => THEMES[name] || THEMES.desert, makeDecor };
})(typeof window !== 'undefined' ? window : globalThis);
