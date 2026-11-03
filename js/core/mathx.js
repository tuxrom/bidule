/**
 * mathx.js
 * Trigonométrie déterministe. Math.sin/cos ne sont pas garantis identiques d'un
 * moteur JavaScript à l'autre ; ce développement de Taylor n'emploie que des
 * additions, multiplications et divisions IEEE, identiques partout. Il sert à
 * la balistique du canon, qui doit rester synchronisée entre deux machines.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const DEG = 0.017453292519943295;

  /** Sinus d'un angle en degrés. */
  function sinDeg(d) {
    d = (((d % 360) + 540) % 360) - 180;             // [-180, 180)
    if (d > 90) d = 180 - d; else if (d < -90) d = -180 - d;
    const x = d * DEG, x2 = x * x;
    return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - x2 / 156))))));
  }
  NS.sinDeg = sinDeg;
  NS.cosDeg = (d) => sinDeg(d + 90);
})(typeof window !== 'undefined' ? window : globalThis);
