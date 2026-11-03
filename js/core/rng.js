/**
 * rng.js
 * Générateur pseudo-aléatoire à graine (mulberry32).
 * Seul ce générateur est autorisé dans la simulation : Math.random() est
 * réservé aux effets purement visuels (particules). L'état tient dans un
 * entier de 32 bits, ce qui permet de le sauvegarder dans un instantané.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  class RNG {
    constructor(seed) {
      this.a = seed | 0;
    }
    /** Flottant dans [0, 1). */
    next() {
      this.a = (this.a + 0x6d2b79f5) | 0;
      let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** Entier dans [min, max] inclus. */
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    }
    getState() { return this.a; }
    setState(s) { this.a = s | 0; }
  }

  NS.RNG = RNG;
})(typeof window !== 'undefined' ? window : globalThis);
