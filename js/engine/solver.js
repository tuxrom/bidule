/**
 * solver.js
 * Le « robot » qui sait finir un niveau : il applique le plan de solution d'un niveau (une liste de règles
 * {skill, x0, x1, y, dir, after, st}) dans la VRAIE simulation, par les mêmes commandes que le joueur.
 *
 * Utilisé par les tests (chaque niveau doit être gagné par son plan), par le jeu pour les indices (où va la
 * prochaine compétence) et pour la démonstration de la solution. Aucune dépendance au DOM.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  const Solver = {
    /** Ce Bidule est-il dans la fenêtre de la règle ? */
    inWindow(r, b) {
      return (r.st || ['walk']).includes(b.state) && b.dir === (r.dir || 1) && b.x >= r.x0 && b.x <= r.x1 && Math.abs(b.y - r.y) <= 2;
    },

    /**
     * Un pas du robot (à appeler avant sim.step()) : chaque règle non faite donne sa compétence au Bidule de
     * TÊTE parmi ceux qui sont dans sa fenêtre. `done` (Set des règles appliquées) est mis à jour.
     * Renvoie les commandes émises.
     */
    play(sim, plan, done, player) {
      const out = [];
      (plan || []).forEach((r, i) => {
        if (done.has(i) || (r.after && sim.tick < r.after)) return;
        let lead = null;
        for (const b of sim.bidules) {
          if (b.owner !== (player | 0) || !this.inWindow(r, b) || !sim.canAssign(b, r.skill)) continue;
          if (!lead || (b.x - lead.x) * (r.dir || 1) > 0) lead = b;
        }
        if (lead) {
          const cmd = { type: 'assign', id: lead.id, skill: r.skill, player: player | 0 };
          if (sim.issue(cmd)) { done.add(i); out.push(cmd); }
        }
      });
      return out;
    },

    /** Joue tout le niveau avec son plan ; renvoie la simulation terminée. */
    solve(def) {
      const sim = new NS.Simulation(def), done = new Set();
      while (sim.status === 'running') { this.play(sim, def.plan, done); sim.step(); }
      return sim;
    },

    /**
     * Les ordres déjà donnés par le joueur couvrent-ils la règle ? Une compétence identique donnée près de la
     * fenêtre (à 16 px près) compte comme faite. `orders` : [{skill, x, y}].
     */
    covered(r, orders) {
      return orders.some((o) => o.skill === r.skill && o.x >= r.x0 - 16 && o.x <= r.x1 + 16 && Math.abs(o.y - r.y) <= 12);
    },

    /** Première règle du plan que les ordres du joueur ne couvrent pas encore (index), ou -1. */
    nextRule(plan, orders) {
      return (plan || []).findIndex((r) => !this.covered(r, orders));
    }
  };

  NS.Solver = Solver;
})(typeof window !== 'undefined' ? window : globalThis);
