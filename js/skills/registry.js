/**
 * registry.js
 * Registre des compétences. Une compétence est un objet déclaratif :
 *
 *   id         identifiant stable (utilisé dans les commandes, donc dans le réseau)
 *   label      nom affiché
 *   state      état du Bidule pendant l'action (null pour une compétence passive)
 *   canAssign  (bidule, sim) -> bool : le Bidule peut-il la recevoir ?
 *   assign     (bidule, sim)         : applique la compétence
 *   update     (bidule, sim)         : un pas de simulation de l'état `state`
 *
 * Ajouter une compétence = écrire un fichier qui appelle Skills.register().
 * Le moteur, l'interface et la barre d'outils la découvrent automatiquement.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  /** Table état -> fonction de mise à jour (marche et chute sont dans bidule.js). */
  NS.Behaviors = NS.Behaviors || {};

  /** États "de travail" dans lesquels un outil peut être remplacé par un autre. */
  const WORK_STATES = { walk: 1, wait: 1, build: 1, dig: 1, mine: 1, bash: 1 };

  const Skills = {
    list: [],
    byId: {},

    register(def) {
      this.list.push(def);
      this.byId[def.id] = def;
      if (def.state && def.update) NS.Behaviors[def.state] = def.update;
    },

    /** Règle commune des outils : on peut changer d'outil en cours de travail. */
    isWorkState(state) { return WORK_STATES[state] === 1; }
  };

  NS.Skills = Skills;
})(typeof window !== 'undefined' ? window : globalThis);
