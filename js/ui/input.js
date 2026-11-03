/**
 * input.js
 * Entrées utilisateur unifiées via les Pointer Events (souris, doigt, stylet).
 *
 * Souris : clic gauche = appliquer la compétence ; glisser (bouton gauche,
 *          milieu ou droit) = déplacer la carte ; molette = zoom.
 * Tactile : un appui = appliquer ; deux doigts = pincer pour zoomer et
 *           glisser pour défiler (un doigt seul ne déplace jamais la carte, ce
 *           qui évite les mauvaises manipulations).
 * Clavier : voir la table KEYS ci-dessous (basée sur event.code pour les
 *           chiffres, afin de fonctionner aussi sur AZERTY sans Maj).
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  const TAP_SLOP = 8;       // déplacement maximal (px) d'un appui pour rester un "tap"
  const TAP_TIME = 600;     // durée maximale (ms) d'un appui

  class Input {
    constructor(game, canvas) {
      this.game = game;
      this.canvas = canvas;
      this.pointers = new Map();
      this.gesture = null;
      this.gestured = false;     // un geste à deux doigts a eu lieu : plus de tap jusqu'au relâchement
      this.keys = new Set();     // flèches maintenues (défilement continu)
      this.snapTimer = null;

      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', (e) => this.onCancel(e));
      canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') game.hover(-1, -1); });
      canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', (e) => this.onKey(e, true));
      window.addEventListener('keyup', (e) => this.onKey(e, false));
      window.addEventListener('blur', () => this.keys.clear());
    }

    local(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    /* ------------------------------- Pointeurs ------------------------------- */

    onDown(e) {
      this.game.audio.unlock();
      const p = this.local(e);
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, {
        x: p.x, y: p.y, sx: p.x, sy: p.y, t0: performance.now(),
        type: e.pointerType, button: e.button, moved: false
      });
      if (this.pointers.size === 2) {
        this.gestured = true;
        this.gesture = this.measure();
      }
    }

    measure() {
      const [a, b] = [...this.pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }

    onMove(e) {
      const p = this.local(e);
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) {
        if (e.pointerType === 'mouse') this.game.hover(p.x, p.y);
        return;
      }
      const dx = p.x - ptr.x, dy = p.y - ptr.y;
      ptr.x = p.x; ptr.y = p.y;
      if (Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > TAP_SLOP) ptr.moved = true;
      const cam = this.game.cam;

      if (this.pointers.size === 2) {                       // pincement + défilement à deux doigts
        const m = this.measure();
        cam.zoomAt(m.mx, m.my, cam.zoom * (m.dist / this.gesture.dist));
        cam.panBy(m.mx - this.gesture.mx, m.my - this.gesture.my);
        this.gesture = m;
      } else if (ptr.type === 'mouse') {                    // la souris peut faire glisser la carte
        this.game.hover(p.x, p.y);
        if (ptr.moved || ptr.button === 1 || ptr.button === 2) cam.panBy(dx, dy);
      }
    }

    onUp(e) {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.gesture = null;
      if (this.pointers.size === 0) {
        const wasGesture = this.gestured;
        this.gestured = false;
        const quick = performance.now() - ptr.t0 < TAP_TIME;
        if (wasGesture) this.game.cam.snap(this.game.renderer.dpr);
        else if (!ptr.moved && quick && ptr.button === 0) this.game.tap(ptr.x, ptr.y, ptr.type !== 'mouse');
      }
    }

    onCancel(e) {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) { this.gestured = false; this.gesture = null; }
    }

    onWheel(e) {
      e.preventDefault();
      const cam = this.game.cam, p = this.local(e);
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (e.shiftKey) { cam.panBy(-dy, 0); return; }
      cam.zoomAt(p.x, p.y, cam.zoom * Math.pow(1.0018, -dy));
      clearTimeout(this.snapTimer);
      this.snapTimer = setTimeout(() => cam.snap(this.game.renderer.dpr), 160);
    }

    /* -------------------------------- Clavier -------------------------------- */

    onKey(e, down) {
      const g = this.game;
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { if (down) { e.preventDefault(); g.undo(); } return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.startsWith('Arrow')) {
        if (down) this.keys.add(e.key); else this.keys.delete(e.key);
        e.preventDefault();
        return;
      }
      if (!down) return;
      g.audio.unlock();
      // Chiffres : event.code ne dépend pas de la disposition (AZERTY, QWERTY).
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) { g.selectSkillIndex(Number(m[1]) - 1); e.preventDefault(); return; }
      switch (e.key) {
        case ' ': case 'p': case 'P': g.togglePause(); e.preventDefault(); break;
        case 'f': case 'F': g.cycleSpeed(); break;
        case 'u': case 'U': g.undo(); break;
        case 'm': case 'M': g.toggleMute(); break;
        case 'r': case 'R': g.restart(); break;
        case 'h': case 'H': case '?': g.showHelp(); break;
        case 'Escape': g.toggleMenu(); break;
        case '+': case '=': g.zoomStep(1.25); break;
        case '-': case '_': g.zoomStep(0.8); break;
        case 'PageUp': g.adjustRate(5); break;
        case 'PageDown': g.adjustRate(-5); break;
      }
    }

    /** Défilement continu aux flèches (appelé à chaque image). */
    update(dt) {
      if (!this.keys.size) return;
      const v = 520 * dt;
      let dx = 0, dy = 0;
      if (this.keys.has('ArrowLeft')) dx += v;
      if (this.keys.has('ArrowRight')) dx -= v;
      if (this.keys.has('ArrowUp')) dy += v;
      if (this.keys.has('ArrowDown')) dy -= v;
      this.game.cam.panBy(dx, dy);
    }
  }

  NS.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
