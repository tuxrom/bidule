/**
 * constants.js
 * Constantes partagées par la simulation, le rendu et l'interface.
 * Tout ce qui influence le déterminisme de la simulation vit ici : changer une
 * valeur modifie le comportement du jeu, donc invalide les rediffusions.
 *
 * Convention de module : chaque fichier est une IIFE qui s'accroche à
 * l'espace de noms global `Bidules` (window en navigateur, globalThis sous Node).
 * Cela permet d'ouvrir index.html directement (file://), ce que les modules ES
 * interdisent dans la plupart des navigateurs.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  /** Matériaux d'un pixel du terrain (un octet par pixel). */
  NS.M = Object.freeze({
    AIR: 0,
    SAND: 1,   // sable : destructible
    ROCK: 2,   // roche : indestructible
    BRICK: 3,  // brique posée par le camp 0 : destructible, solide pour lui seul
    WATER: 4,  // eau : mortelle
    LAVA: 5,   // lave : mortelle
    BRICK_B: 6 // brique du camp 1 (solide pour lui seul, traversable par le camp 0)
  });

  /** Tables de propriétés indexées par matériau (lecture O(1) dans les boucles chaudes). */
  NS.SOLID = Uint8Array.from([0, 1, 1, 1, 0, 0, 1]);
  NS.DIGGABLE = Uint8Array.from([0, 1, 0, 1, 0, 0, 1]);

  NS.C = Object.freeze({
    TICK_RATE: 30,        // pas de simulation par seconde
    BODY_H: 10,           // hauteur d'un Bidule en pixels
    MAX_CLIMB: 5,         // marche franchissable sans aide (pixels)
    MAX_DROP: 3,          // dénivelé descendu en marchant sans tomber
    FATAL_FALL: 56,       // chute mortelle au-delà de cette hauteur (pixels)
    FLOAT_START: 10,      // hauteur de chute avant ouverture du parachute
    BOMB_TICKS: 150,      // compte à rebours du kamikaze (5 s)
    BOMB_RADIUS: 16,      // rayon du cratère (centré sur les pieds)
    HATCH_DELAY: 45,      // délai avant le premier Bidule
    RATE_MIN: 1,
    RATE_MAX: 99,
    END_GRACE_TICKS: 20,  // pause avant de déclarer la fin quand tout est résolu
    BLAST_MAX_KILLS: 3,   // une explosion tue au plus 3 Bidules (les plus proches) : équilibrage, voir docs
    BEAM_MAX_KILLS: 3     // le rayon orbital aussi
  });

  /** Intervalle (en pas) entre deux Bidules pour une cadence 1..99. */
  NS.rateToInterval = function (rate) {
    return 8 + (99 - rate);
  };
})(typeof window !== 'undefined' ? window : globalThis);
