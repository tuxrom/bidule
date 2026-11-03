/**
 * floater.js - Parachutiste : compétence passive et permanente. Le parachute
 * s'ouvre tout seul après 10 pixels de chute et annule le dégât de chute.
 */
(function (G) {
  'use strict';
  const NS = G.Bidules;
  NS.Skills.register({
    id: 'floater',
    label: 'Parachute',
    state: null,
    canAssign: (b) => !b.floater && b.state !== 'dead' && b.state !== 'saved',
    assign(b) { b.floater = true; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
