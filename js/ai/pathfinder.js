/**
 * pathfinder.js
 * Planificateur A* de l'IA. Il cherche, depuis la position d'un Bidule, la
 * suite de déplacements ET de compétences qui mène à la sortie.
 *
 * Nœuds : (x, y, sens) = un Bidule debout (pieds en (x, y), sol dessous).
 *
 * Arêtes :
 *  - MARCHE : un pixel de plus, calculé par les mêmes règles que la simulation
 *    (marche jusqu'à 5 px, descente jusqu'à 3 px) ; un bord sans sol devient
 *    une CHUTE jusqu'à l'appui suivant (mortelle au-delà de 56 px, ou dans
 *    l'eau/la lave : arête interdite) ;
 *  - COMPÉTENCE : à un nœud d'où un obstacle se trouve à moins de 45 px devant
 *    (mur, chute mortelle, liquide), on essaie chaque outil disponible dans une
 *    SIMULATION D'ESSAI (Simulation.sandbox) : un Bidule seul, sur une copie du
 *    terrain, avec la vraie physique. Là où il se remet à marcher débouche
 *    l'arête. Aucune géométrie « à la main » : si les règles du jeu changent, le
 *    planificateur suit.
 *
 * L'IA n'a pas d'avantage : elle ne lit que le terrain (carte symétrique,
 * connue des deux camps) et ses propres stocks.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const C = NS.C, M = NS.M;

  // Le creuseur est exclu : son puits laisse tomber tous les suivants. Un plan ne doit pas sacrifier l'armée.
  const TOOLS = ['builder', 'basher', 'miner'];
  const TOOL_COST = { builder: 40, basher: 30, miner: 60 };
  const LOOKAHEAD = 45;        // distance à laquelle un obstacle déclenche l'essai des outils
  const SAMPLE = 3;            // on n'essaie les outils que tous les 3 pixels
  const MAX_EXPAND = 9000;     // garde-fou : nœuds développés au plus
  const key = (x, y, d) => ((y * 4096 + x) << 1) | (d > 0 ? 1 : 0);

  /* ------------------------------ Tas binaire min ------------------------------ */
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(item) {
      const a = this.a; a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].f < a[m].f) m = l;
          if (r < a.length && a[r].f < a[m].f) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
  }

  /* ----------------------------- Règles de marche ------------------------------ */

  /**
   * Un pas de marche en lecture seule (miroir de Physics.tryWalk, sans obstacles
   * d'équipe). Renvoie {kind: 'moved'|'wall'|'fall', x, y}.
   */
  function stepWalk(t, x, y, dir) {
    const nx = x + dir;
    let ny = -1;
    for (let k = 0; k <= C.MAX_CLIMB; k++) if (t.freeColumn(nx, y - k, C.BODY_H)) { ny = y - k; break; }
    if (ny < 0) return { kind: 'wall' };
    let d = 0;
    while (d <= C.MAX_DROP && !t.isSolid(nx, ny + 1)) { ny++; d++; }
    if (d > C.MAX_DROP) return { kind: 'fall', x: nx, y };
    return { kind: 'moved', x: nx, y: ny };
  }

  /** Chute libre depuis (x, y) : {ok, y, dist}. Mortelle ou liquide : ok = false. */
  function fallLand(t, x, y) {
    let dist = 0;
    while (!t.isSolid(x, y + 1)) {
      y++; dist++;
      if (y >= t.h + 4) return { ok: false };
      const m = t.get(x, y);
      if (m === M.WATER || m === M.LAVA) return { ok: false };
    }
    if (dist > C.FATAL_FALL) return { ok: false };
    return { ok: true, y, dist };
  }

  /** Premier obstacle dans les `n` pas devant (x, y, dir) : 'wall', 'gap' (chute mortelle ou liquide) ou null. */
  function blockedAhead(t, x, y, dir, n) {
    for (let i = 0; i < n; i++) {
      const s = stepWalk(t, x, y, dir);
      if (s.kind === 'wall') return 'wall';
      if (s.kind === 'fall') {
        const l = fallLand(t, s.x, s.y);
        if (!l.ok) return 'gap';
        x = s.x; y = l.y;
      } else { x = s.x; y = s.y; }
    }
    return null;
  }

  /**
   * Point de mort sur la trajectoire d'un Bidule qui marche tout droit : le
   * dernier nœud sûr avant une chute mortelle ou un liquide, ou null si un mur
   * le fait demi-tour avant (ou si la carte se termine).
   */
  function deathAhead(t, x, y, dir, maxLen) {
    let last = { x, y, dir, dist: 0 };
    for (let i = 0; i < maxLen; i++) {
      const s = stepWalk(t, x, y, dir);
      if (s.kind === 'wall') return null;
      if (s.kind === 'fall') {
        const l = fallLand(t, s.x, s.y);
        if (!l.ok) return last;
        x = s.x; y = l.y;
      } else { x = s.x; y = s.y; }
      if (x < 2 || x >= t.w - 2) return null;
      last = { x, y, dir, dist: i + 1 };
    }
    return null;
  }

  /* ------------------------ Simulation d'essai d'une compétence ----------------------- */

  /**
   * Un Bidule seul reçoit `skill` en `node` ; on le laisse faire. Renvoie le
   * nœud où il se remet à marcher, {goal: true} s'il atteint la sortie, ou
   * null s'il meurt, tourne en rond ou n'avance pas.
   */
  function trySkill(sim, node, skill, owner) {
    const sb = NS.Simulation.sandbox(sim);
    sb.terrain.setViewer(owner);
    const b = new NS.Bidule(1, node.x, node.y, node.dir, owner);
    b.state = 'walk';
    sb.bidules.push(b);
    NS.Skills.byId[skill].assign(b, sb);
    const worker = b.state;
    let left = false;
    for (let tick = 1; tick <= 520; tick++) {
      NS.Physics.update(b, sb);
      if (b.state === 'saved') return { goal: true, ticks: tick };
      if (b.state === 'dead') return null;
      if (b.state !== worker && b.state !== 'wait') left = true;
      if (left && b.state === 'walk' && tick > 3) {
        if (b.dir !== node.dir) return null;                       // heurté une roche : demi-tour
        const moved = Math.abs(b.x - node.x) + Math.abs(b.y - node.y);
        if (moved < 6) return null;
        return { x: b.x, y: b.y, dir: b.dir, ticks: tick };
      }
    }
    return null;
  }

  /* ----------------------------------- A* --------------------------------------- */

  /**
   * @param {Simulation} sim
   * @param {number} pi  joueur qui planifie (ses stocks, sa sortie)
   * @param {{x,y,dir}} start
   * @param {{maxActions?: number, margin?: number}} opts  plan partiel à ce nombre d'actions ; marge d'exécution (px)
   * @returns {{found, actions: [{skill,x,y,dir}], cost, expanded}}
   */
  function plan(sim, pi, start, opts) {
    const maxActions = (opts && opts.maxActions) || Infinity;
    // Marge d'exécution : l'IA ne décide que tous les `think` pas, donc le Bidule peut avoir avancé de
    // `think - 1` pixels au moment de l'ordre. L'outil doit y réussir encore.
    const MARGIN = (opts && opts.margin) != null ? opts.margin : 3;
    const t = sim.terrain, p = sim.players[pi], ex = p.exit;
    const h = (x, y) => Math.abs(x - ex.x) + Math.abs(y - ex.y) * 0.3;
    const isGoal = (x, y) => Math.abs(x - ex.x) <= 4 && y >= ex.y - 8 && y <= ex.y + 3;
    const open = new Heap();
    const best = new Map();
    const skillOk = (s) => (p.skills[s] | 0) > 0;
    const tools = TOOLS.filter(skillOk);
    const trials = new Map();       // essais d'outil déjà faits : ils ne dépendent que du nœud
    const robust = (n, skill) => {
      let x = n.x, y = n.y;
      for (let i = 0; i < MARGIN; i++) {
        const s = stepWalk(t, x, y, n.dir);
        if (s.kind !== 'moved') return false;                    // trop près de l'obstacle : aucune tolérance d'exécution
        x = s.x; y = s.y;
      }
      const r = trySkill(sim, { x, y, dir: n.dir }, skill, pi);
      if (!r) return false;
      if (r.goal) return true;
      return deathAhead(t, r.x, r.y, r.dir, 14) === null;   // le départ en retard ne doit pas finir dans le vide
    };

    t.setViewer(pi);                 // le planificateur voit le terrain comme son camp
    try { return search(); } finally { t.setViewer(2); }

    function search() {
    const s0 = { x: start.x, y: start.y, dir: start.dir, g: 0, f: h(start.x, start.y), parent: null, via: null, na: 0 };
    best.set(key(s0.x, s0.y, s0.dir), s0);
    open.push(s0);
    let expanded = 0;

    const relax = (n, x, y, dir, cost, via) => {
      const k = key(x, y, dir), g = n.g + cost, old = best.get(k);
      if (old && old.g <= g) return;
      const nn = { x, y, dir, g, f: g + h(x, y), parent: n, via, na: n.na + (via ? 1 : 0) };
      best.set(k, nn);
      open.push(nn);
    };

    while (open.size && expanded < MAX_EXPAND) {
      const n = open.pop();
      if (best.get(key(n.x, n.y, n.dir)) !== n) continue;       // entrée périmée
      expanded++;
      if (isGoal(n.x, n.y) || n.na >= maxActions) return finish(n, expanded);

      // Marche.
      const s = stepWalk(t, n.x, n.y, n.dir);
      if (s.kind === 'moved') relax(n, s.x, s.y, n.dir, 1, null);
      else if (s.kind === 'fall') {
        const l = fallLand(t, s.x, s.y);
        if (l.ok) relax(n, s.x, l.y, n.dir, 1 + l.dist * 0.05, null);
      }

      // Outils, seulement près d'un obstacle et tous les SAMPLE pixels.
      // Le mineur sert aussi à quitter une route qui mène à une chute mortelle plus loin (tous les 12 px).
      // Un gouffre n'appelle que le bâtisseur ; un mur, n'importe quel outil.
      const near = tools.length && n.x % SAMPLE === 0 ? blockedAhead(t, n.x, n.y, n.dir, LOOKAHEAD) : null;
      const far = tools.length && !near && n.x % 12 === 0 && tools.includes('miner') && deathAhead(t, n.x, n.y, n.dir, 600) !== null;
      if (near || far) {
        for (const skill of tools) {
          if (!near && skill !== 'miner') continue;
          if (near === 'gap' && skill !== 'builder') continue;
          const tk = key(n.x, n.y, n.dir) * 8 + TOOLS.indexOf(skill);
          let r = trials.get(tk);
          if (r === undefined) { r = trySkill(sim, n, skill, pi); trials.set(tk, r); }
          if (!r) continue;
          // Marge : l'exécution peut avoir du retard (intervalle entre deux décisions), donc le départ retenu
          // doit rester valable plus loin.
          if (!r.goal && !robust(n, skill)) continue;
          if (r.goal) return finish({ x: ex.x, y: ex.y, dir: n.dir, g: n.g + TOOL_COST[skill], parent: n, via: { skill, x: n.x, y: n.y, dir: n.dir }, na: n.na + 1 }, expanded);
          relax(n, r.x, r.y, r.dir, TOOL_COST[skill] + r.ticks * 0.05, { skill, x: n.x, y: n.y, dir: n.dir });
        }
      }
    }
    return { found: false, actions: [], cost: Infinity, expanded };
    }

    function finish(node, exp) {
      const actions = [];
      for (let q = node; q; q = q.parent) if (q.via) actions.push(q.via);
      actions.reverse();
      return { found: true, actions, cost: node.g, expanded: exp };
    }
  }

  NS.Pathfinder = { plan, stepWalk, fallLand, deathAhead, blockedAhead, trySkill, Heap };
})(typeof window !== 'undefined' ? window : globalThis);
