/**
 * renderer.js
 * Dessine l'état de la simulation sur un canvas 2D. Le terrain vit dans un
 * canvas hors écran de la taille du monde ; seuls les rectangles modifiés
 * sont repeints (putImageData), puis le tout est mis à l'échelle d'un seul
 * drawImage sans lissage : pixel art net, coût quasi nul par image.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const M = NS.M;

  /** Empaquette une couleur en entier ABGR (ordre mémoire RGBA, petit-boutiste). */
  function pack(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }

  const SAND = [pack(232, 184, 106), pack(224, 174, 96), pack(214, 163, 86), pack(238, 193, 118)];
  const SAND_BAND = [pack(214, 160, 88), pack(206, 152, 80), pack(198, 145, 74), pack(220, 168, 94)];
  const SAND_TOP = pack(250, 218, 148), SAND_LOW = pack(176, 126, 64);
  const ROCK = [pack(112, 74, 72), pack(98, 64, 64), pack(124, 84, 80), pack(104, 68, 68)];
  const ROCK_TOP = pack(158, 112, 100), ROCK_LOW = pack(68, 42, 48);
  const BRICK = pack(204, 114, 62), BRICK_MORTAR = pack(150, 80, 46), BRICK_TOP = pack(238, 160, 100);
  const WATER = [pack(46, 125, 214), pack(58, 138, 224), pack(40, 112, 200), pack(52, 130, 218)];
  const WATER_TOP = pack(150, 208, 252);
  const LAVA = [pack(255, 106, 26), pack(255, 150, 40), pack(240, 86, 20), pack(255, 130, 34)];
  const LAVA_TOP = pack(255, 232, 128);
  const CAVE = [pack(128, 90, 62), pack(120, 84, 58), pack(134, 95, 66), pack(124, 87, 60)];
  const CAVE_SHADE = pack(92, 63, 44);

  /** Bruit déterministe par position (même grain de sable à chaque repeinte). */
  function noise(x, y) {
    let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return (h ^ (h >>> 15)) >>> 0;
  }

  class Renderer {
    constructor(canvas, camera) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.cam = camera;
      this.dpr = 1;
      this.maxDpr = 2;         // plafond de résolution, abaissé automatiquement si l'appareil peine
      this.terrainCanvas = null;
      this.tctx = null;
      this.img = null;
      this.pix = null;
      this.layers = [];
      this.sky = null;
      this.surfaces = [];
      this.cave = null;
    }

    /** Ajuste la résolution interne à la taille CSS (plafonnée à 2x pour les performances). */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
      this.cam.setViewport(rect.width, rect.height);
    }

    /** Prépare tout ce qui dépend du niveau (terrain, décor, fonds). */
    setLevel(sim) {
      const t = sim.terrain, def = sim.def;
      this.terrainCanvas = document.createElement('canvas');
      this.terrainCanvas.width = t.w; this.terrainCanvas.height = t.h;
      this.tctx = this.terrainCanvas.getContext('2d');
      this.img = this.tctx.createImageData(t.w, t.h);
      this.pix = new Uint32Array(this.img.data.buffer);
      this.buildCave(t);
      this.paintRegion(t, 0, 0, t.w - 1, t.h - 1);
      this.tctx.putImageData(this.img, 0, 0);
      t.takeDirty();
      this.buildSurfaces(t);
      this.buildBackground(def);
    }

    /** Repeint tout le terrain (après une annulation ou un redémarrage). */
    invalidate(t) {
      this.paintRegion(t, 0, 0, t.w - 1, t.h - 1);
      this.tctx.putImageData(this.img, 0, 0);
      this.buildSurfaces(t);
      t.takeDirty();
    }

    /**
     * Fond de paroi : tout pixel situé sous la première matière solide de sa
     * colonne (au chargement) est "souterrain". Une fois creusé, il montre
     * un fond de roche sombre au lieu du ciel.
     */
    buildCave(t) {
      this.cave = new Uint8Array(t.w * t.h);
      for (let x = 0; x < t.w; x++) {
        let under = false;
        for (let y = 0; y < t.h; y++) {
          const m = t.data[y * t.w + x];
          if (m === M.SAND || m === M.ROCK || m === M.BRICK) under = true;
          if (under) this.cave[y * t.w + x] = 1;
        }
      }
    }

    /** Couleur de chaque pixel d'une zone, avec éclairage de surface et strates. */
    paintRegion(t, x0, y0, x1, y1) {
      const pix = this.pix, w = t.w, d = t.data;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const m = d[y * w + x];
          let c = 0;
          if (m === M.AIR) {
            if (this.cave[y * w + x]) {
              const up = y > 0 ? d[(y - 1) * w + x] : M.AIR;
              c = (up === M.SAND || up === M.ROCK || up === M.BRICK) ? CAVE_SHADE : CAVE[noise(x, y) & 3];
            }
          } else {
            const n = noise(x, y), k = n & 3;
            const up = y > 0 ? d[(y - 1) * w + x] : M.ROCK;
            const down = y < t.h - 1 ? d[(y + 1) * w + x] : M.ROCK;
            switch (m) {
              case M.SAND:
                if (up === M.AIR || up >= M.WATER) c = SAND_TOP;
                else if (down === M.AIR || down >= M.WATER) c = SAND_LOW;
                else c = ((((y >> 3) + ((n >> 8) & 1)) & 1) ? SAND_BAND : SAND)[k];
                break;
              case M.ROCK:
                c = (up === M.AIR || up >= M.WATER) ? ROCK_TOP : (down === M.AIR ? ROCK_LOW : ROCK[k]);
                break;
              case M.BRICK: {
                const row = y & 3, off = ((y >> 2) & 1) * 3;
                if (up === M.AIR) c = BRICK_TOP;
                else if (row === 3 || ((x + off) & 5) === 0) c = BRICK_MORTAR;
                else c = BRICK;
                break;
              }
              case M.WATER: c = up === M.AIR ? WATER_TOP : WATER[k]; break;
              case M.LAVA: c = up === M.AIR ? LAVA_TOP : LAVA[k]; break;
            }
          }
          pix[y * w + x] = c;
        }
      }
    }

    /** Liste des pixels de surface d'eau/lave, animés à chaque image. */
    buildSurfaces(t) {
      this.surfaces = [];
      for (let x = 0; x < t.w; x++) {
        for (let y = 1; y < t.h; y++) {
          const m = t.data[y * t.w + x];
          if ((m === M.WATER || m === M.LAVA) && t.data[(y - 1) * t.w + x] === M.AIR) {
            this.surfaces.push({ x, y, lava: m === M.LAVA });
          }
        }
      }
    }

    /** Ciel dégradé, trois couches de dunes en parallaxe, soleil. */
    buildBackground(def) {
      const W = def.width, H = def.height;
      // Ciel : dégradé dessiné UNE fois (un fillRect en dégradé à chaque image est lent en rendu logiciel).
      const sky = document.createElement('canvas');
      sky.width = W; sky.height = H;
      const sg = sky.getContext('2d');
      const grad = sg.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#3f86c2');
      grad.addColorStop(0.5, '#a9cde0');
      grad.addColorStop(0.75, '#f6d8a0');
      grad.addColorStop(1, '#f2b676');
      sg.fillStyle = grad;
      sg.fillRect(0, 0, W, H);
      this.sky = sky;
      const rng = new NS.RNG((def.seed || 1) ^ 0x9e3779b9);
      const specs = [
        { f: 0.15, base: 0.50, amp: 46, col: '#b79bb0', peaks: true },
        { f: 0.30, base: 0.62, amp: 26, col: '#e0a47a', peaks: false },
        { f: 0.55, base: 0.74, amp: 18, col: '#cf8a58', peaks: false }
      ];
      this.layers = specs.map((s) => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const p1 = rng.next() * 6, p2 = rng.next() * 6, p3 = rng.next() * 6;
        g.fillStyle = s.col;
        for (let x = 0; x < W; x++) {
          let v = Math.sin(x * 0.006 + p1) * 0.55 + Math.sin(x * 0.015 + p2) * 0.3 + Math.sin(x * 0.037 + p3) * 0.15;
          if (s.peaks) v = 1 - Math.abs(v) * 1.6;
          const y = Math.round(H * s.base - v * s.amp);
          g.fillRect(x, y, 1, H - y);
        }
        return { canvas: c, f: s.f };
      });
    }

    /* ------------------------------ Image ------------------------------ */

    draw(sim, fx, view) {
      const ctx = this.ctx, cam = this.cam, t = sim.terrain, def = sim.def;
      const s = cam.zoom * this.dpr;
      const time = view.time;

      // Repeindre les zones modifiées du terrain.
      const dr = t.takeDirty();
      if (dr) {
        const x0 = Math.max(0, dr.x0 - 1), y0 = Math.max(0, dr.y0 - 1);
        const x1 = Math.min(t.w - 1, dr.x1 + 1), y1 = Math.min(t.h - 1, dr.y1 + 1);
        this.paintRegion(t, x0, y0, x1, y1);
        this.tctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#f2b676';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);
      ctx.imageSmoothingEnabled = false;

      // Fond.
      // Rectangle visible du monde : on ne recopie que ces pixels (gros gain en rendu logiciel et sur mobile).
      const vx = Math.max(0, Math.floor(cam.x)), vy = Math.max(0, Math.floor(cam.y));
      const vw = Math.min(def.width - vx, Math.ceil(cam.vw / cam.zoom) + 2);
      const vh = Math.min(def.height - vy, Math.ceil(cam.vh / cam.zoom) + 2);
      this.view = { vx, vy, vw, vh };
      this.blit(ctx, this.sky, 0);
      this.drawSun(ctx, def, cam);
      for (const L of this.layers) {
        const ox = Math.round(cam.x * (1 - L.f));   // décalage de parallaxe
        this.blit(ctx, L.canvas, ox);
      }

      // Décor derrière le terrain.
      for (const d of def.decor || []) {
        if (d.type === 'cactus') ctx.drawImage(NS.Sprites.cactus, d.x - 5, d.y - 14);
      }

      this.blit(ctx, this.terrainCanvas, 0);
      this.drawSurfaces(ctx, time);
      this.drawHatch(ctx, sim, time);
      this.drawExit(ctx, def, time);

      // Bidules.
      const F = NS.Sprites.frames;
      for (const b of sim.bidules) {
        const f = F[NS.Sprites.frameFor(b)];
        const img = b.dir >= 0 ? f.r : f.l;
        const px = Math.round(b.x) - 4, py = Math.round(b.y) - 9;
        if (b.floating) {
          ctx.drawImage(NS.Sprites.parachute, px - 3, py - 6);
          ctx.fillStyle = '#17303a';
          ctx.fillRect(px + 1, py - 1, 1, 1); ctx.fillRect(px + 6, py - 1, 1, 1);
        }
        ctx.drawImage(img, px, py);
        if (b.bomb > 0) NS.Sprites.drawDigit(ctx, Math.ceil(b.bomb / NS.C.TICK_RATE), px + 3, py - 8);
        else if (b.floater && !b.floating) { ctx.fillStyle = '#e8553c'; ctx.fillRect(px + 3, py - 2, 2, 1); }
      }

      fx.draw(ctx);

      // Survol : cadre autour du Bidule visé.
      if (view.hoverId) {
        const b = sim.bidules.find((x) => x.id === view.hoverId);
        if (b) {
          ctx.strokeStyle = view.hoverOk ? '#fff6a8' : '#ff7a6a';
          ctx.lineWidth = 1 / s * this.dpr;
          ctx.strokeRect(Math.round(b.x) - 6.5, Math.round(b.y) - 11.5, 13, 14);
        }
      }
    }

    /** Recopie la partie visible d'un canvas de la taille du monde, décalé de `ox` pixels. */
    blit(ctx, img, ox) {
      const v = this.view;
      const sx = Math.max(0, v.vx - ox), ex = Math.min(img.width, v.vx + v.vw - ox);
      if (ex <= sx) return;
      ctx.drawImage(img, sx, v.vy, ex - sx, v.vh, sx + ox, v.vy, ex - sx, v.vh);
    }

    drawSun(ctx, def, cam) {
      const x = def.width * 0.8 + cam.x * 0.9, y = def.height * 0.2;
      ctx.fillStyle = 'rgba(255,240,200,0.25)'; ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.45)'; ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
    }

    /** Trappe d'entrée : boîtier métallique dont les battants s'ouvrent. */
    drawHatch(ctx, sim, time) {
      const h = sim.def.hatch;
      const open = Math.min(1, Math.max(0, (sim.tick - 15) / 20));
      const x = h.x - 14, y = h.y - 12;
      ctx.fillStyle = '#2b3a42'; ctx.fillRect(x, y, 28, 9);
      ctx.fillStyle = '#4b6470'; ctx.fillRect(x, y, 28, 2);
      ctx.fillStyle = '#10181c'; ctx.fillRect(x + 4, y + 6, 20, 3);
      const leaf = Math.round(10 * (1 - open));
      ctx.fillStyle = '#6a8794';
      ctx.fillRect(x + 4, y + 6, leaf, 3); ctx.fillRect(x + 24 - leaf, y + 6, leaf, 3);
      ctx.fillStyle = (Math.floor(time * 4) & 1) ? '#ffd23f' : '#7a5f10';
      ctx.fillRect(x + 2, y + 3, 2, 2); ctx.fillRect(x + 24, y + 3, 2, 2);
    }

    /** Porte de sortie : arche de pierre avec un cœur lumineux animé. */
    drawExit(ctx, def, time) {
      const e = def.exit, x = e.x - 10, y = e.y - 21;
      ctx.fillStyle = '#7a5a48'; ctx.fillRect(x, y, 20, 24);
      ctx.fillStyle = '#9a7660'; ctx.fillRect(x, y, 20, 3); ctx.fillRect(x, y, 3, 24);
      const g = 0.6 + 0.4 * Math.sin(time * 5);
      ctx.fillStyle = 'rgb(' + Math.round(255 * g) + ',' + Math.round(214 * g) + ',' + Math.round(90 * g) + ')';
      ctx.fillRect(x + 4, y + 6, 12, 18);
      ctx.fillStyle = '#fff6c8'; ctx.fillRect(x + 7, y + 9, 6, 15);
      ctx.fillStyle = '#e8553c'; ctx.fillRect(x + 9, y - 6, 1, 6); ctx.fillRect(x + 10, y - 6, 5, 3);
    }

    /** Reflets mobiles sur l'eau et la lave. */
    drawSurfaces(ctx, time) {
      const ph = Math.floor(time * 6);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? 'rgba(255,248,200,0.9)' : 'rgba(220,240,255,0.9)';
        for (const p of this.surfaces) {
          if (p.lava !== (pass === 1)) continue;
          if (((p.x + ph + (p.y & 3)) & 7) < 2) ctx.fillRect(p.x, p.y, 1, 1);
          if (((p.x * 3 + ph) & 15) === 0) ctx.fillRect(p.x, p.y - 1, 1, 1);
        }
      }
    }
  }

  NS.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
