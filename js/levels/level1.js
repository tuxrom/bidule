/**
 * level1.js - "Premiers pas" : un gouffre à franchir (bâtisseur), puis une
 * colline de sable à traverser (foreur). Format JSON (voir loader.js).
 */
(function (G) {
  'use strict';
  G.Bidules.Loader.register({
    "id": "dunes-1",
    "name": "Premiers pas",
    "hint": "Choisis une compétence en bas, puis touche un Bidule. Bâtis un pont au bord du gouffre, puis fore la colline.",
    "width": 1200, "height": 480, "seed": 1001,
    "hatch": { "x": 110, "y": 305, "dir": 1 },
    "exit": { "x": 1060, "y": 339 },
    "count": 20, "goal": 50, "timeLimit": 240,
    "rate": { "min": 20, "start": 40 },
    "skills": { "builder": 3, "basher": 3, "digger": 2, "floater": 2 },
    "decor": [
      { "type": "cactus", "x": 230, "y": 340 }, { "type": "cactus", "x": 560, "y": 340 },
      { "type": "cactus", "x": 880, "y": 340 }, { "type": "cactus", "x": 1130, "y": 340 }
    ],
    "terrain": [
      { "op": "heights", "m": "sand", "pts": [[0, 340], [1199, 340]] },
      { "op": "rect", "m": "rock", "x": 0, "y": 462, "w": 1200, "h": 18 },
      { "op": "poly", "m": "sand", "pts": [[690, 340], [705, 262], [760, 262], [775, 340]] },
      { "op": "rect", "m": "air", "x": 450, "y": 340, "w": 40, "h": 140 },
      { "op": "rect", "m": "lava", "x": 450, "y": 430, "w": 40, "h": 50 },
      { "op": "rect", "m": "rock", "x": 0, "y": 0, "w": 8, "h": 480 },
      { "op": "rect", "m": "rock", "x": 1192, "y": 0, "w": 8, "h": 480 }
    ]
  });
})(typeof window !== 'undefined' ? window : globalThis);
