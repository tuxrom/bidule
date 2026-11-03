/**
 * registry.js (armes)
 * Une arme est un objet déclaratif, comme une compétence :
 *
 *   id, label     identifiant stable (commandes réseau) et nom affiché
 *   cost          coût en points
 *   cooldown      recharge, en pas de simulation (30 = 1 s)
 *   stock         stock par défaut (les niveaux le surchargent)
 *   target        mode de visée de l'interface :
 *                 'none' | 'point' | 'bidule' | 'bidule-point' | 'line' | 'aim' | 'pilot'
 *   validate      (sim, player, cmd) -> null | message d'erreur
 *   fire          (sim, player, cmd) : produit l'effet ou crée une entité
 *   kind/update   si l'arme crée une entité : son nom et sa mise à jour par pas
 *
 * La simulation vérifie stock, recharge et points, puis appelle fire().
 * Aucune arme ne touche le DOM : le rendu des entités est dans render/entities.js.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  const Weapons = {
    list: [],
    byId: {},
    byKind: {},
    register(def) {
      this.list.push(def);
      this.byId[def.id] = def;
      if (def.kind) this.byKind[def.kind] = def;
    },
    /** Ajoute une entité à la simulation (identifiant stable, données simples). */
    spawn(sim, kind, owner, props) {
      const e = Object.assign({ id: sim.nextEid++, kind, owner, dead: false }, props);
      sim.entities.push(e);
      return e;
    }
  };

  NS.Weapons = Weapons;
})(typeof window !== 'undefined' ? window : globalThis);
