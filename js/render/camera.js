/**
 * camera.js
 * Caméra 2D : position (coin haut-gauche, en pixels du monde) et zoom.
 * Le zoom minimum fait remplir toute la vue par le monde (pas de bordure
 * vide). Le point sous le curseur reste fixe pendant le zoom.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  class Camera {
    constructor() {
      this.x = 0; this.y = 0; this.zoom = 2;
      this.vw = 800; this.vh = 600;     // taille de la vue en pixels CSS
      this.ww = 1000; this.wh = 480;    // taille du monde
      this.maxZoom = 10;
    }
    setWorld(w, h) { this.ww = w; this.wh = h; this.clamp(); }
    setViewport(w, h) { this.vw = w; this.vh = h; this.clamp(); }
    minZoom() { return Math.max(this.vw / this.ww, this.vh / this.wh); }

    clamp() {
      this.zoom = Math.max(this.minZoom(), Math.min(this.maxZoom, this.zoom));
      this.x = Math.max(0, Math.min(this.ww - this.vw / this.zoom, this.x));
      this.y = Math.max(0, Math.min(this.wh - this.vh / this.zoom, this.y));
    }

    screenToWorld(sx, sy) { return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom }; }

    /** Zoom vers `z` en gardant fixe le point d'écran (sx, sy). */
    zoomAt(sx, sy, z) {
      const wx = this.x + sx / this.zoom, wy = this.y + sy / this.zoom;
      this.zoom = z;
      this.x = wx - sx / this.zoom;
      this.y = wy - sy / this.zoom;
      this.clamp();
    }

    /** Déplacement en pixels d'écran (glisser). */
    panBy(dx, dy) {
      this.x -= dx / this.zoom;
      this.y -= dy / this.zoom;
      this.clamp();
    }

    /** Arrondit le zoom pour que 1 pixel du monde = un nombre entier de pixels écran. */
    snap(dpr) {
      const dev = this.zoom * dpr;
      if (dev >= 2) this.zoomAt(this.vw / 2, this.vh / 2, Math.round(dev) / dpr);
    }
  }

  NS.Camera = Camera;
})(typeof window !== 'undefined' ? window : globalThis);
