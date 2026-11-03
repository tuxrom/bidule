/**
 * generator.js
 * Générateur de niveaux par SEGMENTS. Chaque segment (gouffre, mur, bassin,
 * rebord, îlot, marches, bloc creux) est un module dont la solution est connue :
 * il écrit ses opérations de terrain et enregistre un PLAN, c'est-à-dire des
 * règles « quand un Bidule marchant vers la droite passe entre x0 et x1, lui
 * donner telle compétence ». Un niveau est solvable par construction, et
 * tests/campaign.test.js le vérifie en rejouant les plans dans la vraie
 * simulation. Le plan est une aide aux tests : le jeu ne l'utilise jamais.
 *
 * Le générateur produit aussi les cartes symétriques du mode contre
 * l'ordinateur (buildVS) : la moitié gauche est tirée au sort, la droite en
 * est le miroir exact, donc les deux armées affrontent le même parcours.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const H = 480;
  const BOTTOM = 462;            // première ligne de la roche de fond

  /** Types de segments, avec le niveau de difficulté à partir duquel ils apparaissent. */
  const SEGMENTS = [
    { type: 'gap', from: 0, label: 'gouffre' },
    { type: 'wall', from: 0, label: 'mur de sable' },
    { type: 'pool', from: 1, label: 'bassin' },
    { type: 'ledge', from: 3, label: 'rebord de roche' },
    { type: 'island', from: 6, label: 'îlot de lave' },
    { type: 'steps', from: 8, label: 'descente' },
    { type: 'bloc', from: 10, label: 'bloc creux' }
  ];

  class Layout {
    constructor(gy0) {
      this.ops = [];
      this.plan = [];       // règles de solution
      this.x = 0;           // curseur horizontal
      this.gy = gy0;        // ligne du sol (première ligne solide)
      this.flats = [];      // tronçons plats {x0, x1, gy} où l'on peut poser décor et pièges
      this.labels = [];
    }
    ground(len) {
      this.ops.push({ op: 'heights', m: 'sand', pts: [[this.x, this.gy], [this.x + len - 1, this.gy]] });
      this.flats.push({ x0: this.x, x1: this.x + len - 1, gy: this.gy });
      this.x += len;
    }
    rule(skill, x0, x1, extra) { this.plan.push(Object.assign({ skill, x0, x1 }, extra || {})); }
  }

  /* --------------------------------- Segments --------------------------------- */
  // Chaque fonction lit/écrit le Layout. `r` est le générateur aléatoire.

  const SEG = {
    gap(L, r) {
      const w = r.int(26, 38), cx = L.x;
      L.ops.push({ op: 'rect', m: 'lava', x: cx, y: L.gy + 90, w, h: H - L.gy - 90 });
      L.rule('builder', Math.max(cx + w - 47, cx - 14), cx - 2, { y: L.gy - 1 });
      L.x += w;
    },
    pool(L, r) {
      const w = r.int(26, 36), cx = L.x;
      L.ops.push({ op: 'rect', m: 'sand', x: cx, y: L.gy + 60, w, h: H - L.gy - 60 });
      L.ops.push({ op: 'rect', m: 'water', x: cx, y: L.gy + 12, w, h: 48 });
      L.rule('builder', Math.max(cx + w - 47, cx - 14), cx - 2, { y: L.gy - 1 });
      L.x += w;
    },
    wall(L, r) {
      const h = r.int(40, 120), th = r.int(16, 30), cx = L.x;
      L.ground(th);
      L.ops.push({ op: 'rect', m: 'sand', x: cx, y: L.gy - h, w: th, h });
      L.rule('basher', cx - 14, cx - 3, { y: L.gy - 1 });
    },
    ledge(L, r) {
      const h = r.int(14, 20), cx = L.x;
      L.ground(10);
      L.ops.push({ op: 'rect', m: 'rock', x: cx, y: L.gy - h, w: 10, h });
      L.rule('builder', cx - 36, cx - 30, { y: L.gy - 1 });
    },
    island(L) {
      const cx = L.x;
      L.ops.push({ op: 'rect', m: 'lava', x: cx, y: L.gy + 100, w: 100, h: H - L.gy - 100 });
      L.ops.push({ op: 'rect', m: 'rock', x: cx + 30, y: L.gy, w: 40, h: H - L.gy });
      L.flats.push({ x0: cx + 30, x1: cx + 69, gy: L.gy, noTrap: true });
      L.rule('builder', cx - 10, cx - 2, { y: L.gy - 1 });
      L.rule('builder', cx + 52, cx + 62, { y: L.gy - 1 });
      L.x += 100;
    },
    steps(L, r) {
      const n = r.int(2, 3);
      for (let i = 0; i < n; i++) {
        L.ground(60);
        L.gy += r.int(28, 42);
      }
    },
    bloc(L) {
      // Un plateau de 400 px au-dessus d'une galerie, puis un sol 180 px plus bas.
      const cx = L.x, gy = L.gy;
      L.ops.push({ op: 'rect', m: 'sand', x: cx, y: gy, w: 400, h: H - gy });
      L.ops.push({ op: 'rect', m: 'air', x: cx + 20, y: gy + 140, w: 380, h: 40 });
      L.rule('blocker', cx + 380, cx + 388, { y: gy - 1 });
      L.rule('miner', cx + 100, cx + 108, { y: gy - 1, after: 60 });
      L.x += 400;
      L.gy = gy + 180;
    }
  };

  /* ----------------------------- Paramètres de campagne ---------------------- */

  /** Difficulté 0..39 : nombre de segments, de Bidules, objectif, temps. */
  function params(d) {
    return {
      segments: Math.min(9, 2 + Math.floor(d / 5)),
      count: Math.min(40, 20 + Math.floor(d / 2)),
      goal: 50 + Math.floor(d * 0.65),
      traps: Math.min(6, Math.floor(d / 6)),
      slack: Math.max(0, 2 - Math.floor(d / 14))
    };
  }

  function pickSegments(r, d, n) {
    const avail = SEGMENTS.filter((s) => d >= s.from);
    const out = [];
    let hasBloc = false, drop = 0;
    for (let i = 0; i < n; i++) {
      let s;
      for (let k = 0; k < 20; k++) {
        s = avail[r.int(0, avail.length - 1)];
        if (s.type === 'bloc' && (hasBloc || i === 0)) continue;     // un seul bloc, jamais en tête
        if (s.type === 'steps' && drop + 3 * 42 > 160) continue;      // le sol reste dans la carte
        break;
      }
      if (s.type === 'bloc') hasBloc = true;
      if (s.type === 'steps') drop += 3 * 42;
      out.push(s.type);
    }
    // Un niveau de difficulté moyenne contient au moins un obstacle franchissable au bâtisseur.
    if (d >= 4 && !out.includes('gap') && !out.includes('pool')) out[out.length - 1] = 'gap';
    // Le bloc fait déjà descendre de 180 px : pas de marches en plus dans ce niveau.
    return hasBloc ? out.filter((t) => t !== 'steps') : out;
  }

  const DECOR = { desert: 'cactus', ruins: 'pylon', arctic: 'pine', orbital: 'antenna' };

  /** Stocks de compétences déduits du plan, plus une marge. */
  function skillStocks(plan, slack, d) {
    const need = {};
    for (const p of plan) need[p.skill] = (need[p.skill] || 0) + 1;
    const s = {};
    for (const k of Object.keys(need)) s[k] = need[k] + slack + (k === 'blocker' ? 1 : 0);
    s.floater = 2;
    s.digger = 1;
    return s;
  }

  /**
   * Construit un niveau de campagne.
   * @param {object} o {id, name, world, theme, d (0..39), seed}
   */
  function build(o) {
    const d = o.d, P = params(d), r = new NS.RNG(o.seed);
    let types = pickSegments(r, d, P.segments);
    const gy0 = types.includes('bloc') ? 190 : 230;
    const L = new Layout(gy0);
    L.ground(150);
    for (const t of types) {
      SEG[t](L, r);
      L.ground(r.int(70, 120));
    }
    L.ground(110);
    const W = L.x + 10;
    const ops = L.ops.slice();
    ops.push({ op: 'rect', m: 'rock', x: 0, y: BOTTOM, w: W, h: H - BOTTOM });
    ops.push({ op: 'rect', m: 'rock', x: 0, y: 0, w: 8, h: H });
    ops.push({ op: 'rect', m: 'rock', x: W - 8, y: 0, w: 8, h: H });

    // Pièges cachés sur les grands tronçons plats (hors îlots et départ).
    const traps = [];
    const slots = L.flats.filter((f) => !f.noTrap && f.x0 > 200 && f.x1 - f.x0 > 90);
    for (let i = 0; i < P.traps && slots.length; i++) {
      const f = slots[r.int(0, slots.length - 1)];
      traps.push({ x: r.int(f.x0 + 30, f.x1 - 30), y: f.gy - 1 });
    }
    // Décor.
    const decor = [];
    for (const f of L.flats) {
      if (f.x1 - f.x0 > 70 && r.next() < 0.7) decor.push({ type: DECOR[o.theme], x: r.int(f.x0 + 15, f.x1 - 15), y: f.gy });
    }

    const plan = L.plan;
    const labels = types.map((t) => SEGMENTS.find((s) => s.type === t).label);
    const time = Math.round((90 + W / 14 + P.count * 2.4 + plan.length * 18) * (1 - d * 0.003));
    return {
      id: o.id, name: o.name, world: o.world, theme: o.theme, mode: 'solo',
      hint: 'Sur la route : ' + labels.join(', ') + '.',
      width: W, height: H, seed: o.seed,
      hatch: { x: 90, y: gy0 - 30, dir: 1 },
      exit: { x: W - 70, y: L.gy - 1 },
      cannon: { x: 50, y: gy0 - 1, dir: 1 },
      count: P.count, goal: P.goal, timeLimit: time,
      fog: d >= 10, traps,
      rate: { min: 20, start: 40 },
      skills: skillStocks(plan, P.slack, d),
      decor, terrain: ops,
      plan                       // règles de solution (tests uniquement)
    };
  }

  /* ----------------------------- Carte symétrique (VS) ------------------------ */

  /**
   * Carte pour deux armées : parcours aléatoire sur la moitié gauche, copie en
   * miroir sur la moitié droite. Seuls des obstacles plats et réversibles sont
   * employés (gouffre, bassin, mur, rebord, îlot) : les marches et le bloc
   * creux ne se lisent pas de la même façon dans les deux sens.
   */
  function buildVS(o) {
    const r = new NS.RNG(o.seed), gy = 250;
    const kinds = ['gap', 'wall', 'pool', 'ledge', 'island'];
    const L = new Layout(gy);
    L.ground(190);
    const n = o.segments || 3;
    for (let i = 0; i < n; i++) {
      let k = kinds[r.int(0, kinds.length - 1)];
      if (i === 0 && k === 'island') k = 'gap';
      SEG[k](L, r);
      L.ground(r.int(70, 110));
    }
    const half = L.x;                       // le centre de la carte est à x = half
    L.ground(40);                           // zone centrale plate
    const W = 2 * half + 40;
    // Terrain miroir : chaque opération est reflétée autour du centre.
    const ops = L.ops.slice();
    const mirror = (op) => {
      const c = Object.assign({}, op);
      if (op.op === 'rect') c.x = W - op.x - op.w;
      else if (op.op === 'heights') c.pts = op.pts.map(([x, y]) => [W - 1 - x, y]).reverse();
      return c;
    };
    const mirrored = L.ops.map(mirror);
    ops.push(...mirrored);
    // Le tronçon central : sol plat entre les deux moitiés.
    ops.push({ op: 'heights', m: 'sand', pts: [[half, gy], [W - half - 1, gy]] });
    ops.push({ op: 'rect', m: 'rock', x: 0, y: BOTTOM, w: W, h: H - BOTTOM });
    ops.push({ op: 'rect', m: 'rock', x: 0, y: 0, w: 8, h: H });
    ops.push({ op: 'rect', m: 'rock', x: W - 8, y: 0, w: 8, h: H });

    const traps = [];
    const slots = L.flats.filter((f) => !f.noTrap && f.x0 > 220 && f.x1 - f.x0 > 90);
    for (let i = 0; i < (o.traps || 0) && slots.length; i++) {
      const f = slots[r.int(0, slots.length - 1)];
      const x = r.int(f.x0 + 30, f.x1 - 30);
      traps.push({ x, y: f.gy - 1 }, { x: W - 1 - x, y: f.gy - 1 });   // paire symétrique
    }
    const decor = [];
    for (const f of L.flats) {
      if (f.x1 - f.x0 > 70 && r.next() < 0.6) {
        const x = r.int(f.x0 + 15, f.x1 - 15);
        decor.push({ type: DECOR[o.theme], x, y: f.gy }, { type: DECOR[o.theme], x: W - 1 - x, y: f.gy });
      }
    }
    // Le parcours d'une armée traverse les deux moitiés : les besoins du plan sont doublés, plus une marge.
    const need = (k) => L.plan.filter((r) => r.skill === k).length * 2;
    const skills = { blocker: 3, builder: need('builder') + 3, digger: 2, miner: 2, basher: need('basher') + 3, floater: 3, climber: 3, bomber: 3 };
    const weapons = {};
    for (const w of NS.Weapons.list) weapons[w.id] = w.stock;
    const def = {
      id: o.id, name: o.name, world: o.world || 'vs', theme: o.theme, mode: 'vs',
      hint: 'Ton armée part à gauche, celle de l\'ordinateur à droite. Sauve plus de Bidules que lui.',
      width: W, height: H, seed: o.seed,
      timeLimit: 330, fog: true, traps, decor, terrain: ops,
      skills, weapons, points: { start: 100, regen: 1 }, rate: { min: 20, start: 45 },
      count: o.count || 24, goal: 0,
      players: [
        { hatch: { x: 90, y: gy - 30, dir: 1 }, exit: { x: W - 70, y: gy - 1 }, cannon: { x: 50, y: gy - 1, dir: 1 } },
        { hatch: { x: W - 91, y: gy - 30, dir: -1 }, exit: { x: 69, y: gy - 1 }, cannon: { x: W - 51, y: gy - 1, dir: -1 } }
      ]
    };
    return def;
  }

  NS.Generator = { build, buildVS, params, SEGMENTS, DECOR };
})(typeof window !== 'undefined' ? window : globalThis);
