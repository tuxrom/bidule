/**
 * renderer.js
 * Dessine l'état de la simulation sur un canvas 2D. Le terrain vit dans un
 * canvas hors écran de la taille du monde ; seuls les rectangles modifiés
 * sont repeints (putImageData), puis le tout est mis à l'échelle d'un seul
 * drawImage sans lissage : pixel art net, coût quasi nul par image.
 *
 * Tout ce qui dépend de l'univers (couleurs du sol, ciel, silhouettes, décor)
 * vient d'un thème (themes.js). Les entités des armes (drones, obus,
 * boucliers, mines, chars, câbles...) sont dessinées par `ENTITY_DRAW`, qui
 * ne lit que l'état de la simulation. Le brouillard de guerre est un
 * petit canvas basse résolution agrandi avec lissage, d'où ses bords doux.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const M = NS.M;

  /** Empaquette une couleur en entier ABGR (ordre mémoire RGBA, petit-boutiste). */
  function pack(c) {
    const k = (v) => Math.max(0, Math.min(255, v | 0));       // une variante de teinte ne doit pas déborder d'un canal
    return ((255 << 24) | (k(c[2]) << 16) | (k(c[1]) << 8) | k(c[0])) >>> 0;
  }

  /** Bruit déterministe par position (même grain à chaque repeinte). */
  function noise(x, y) {
    let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return (h ^ (h >>> 15)) >>> 0;
  }

  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  /* ------------------------ Dessin des entités des armes ------------------------ */
  // Chaque fonction reçoit (ctx, e, sim, time, visible). Coordonnées du monde.

  const ENTITY_DRAW = {
    drone(ctx, e, sim, time) {
      const x = Math.round(e.x), y = Math.round(e.y);
      ctx.fillStyle = '#17303a'; ctx.fillRect(x - 4, y - 1, 8, 3);
      ctx.fillStyle = e.owner ? '#d8574a' : '#3fb6c9'; ctx.fillRect(x - 3, y - 1, 6, 2);
      ctx.fillStyle = (Math.floor(time * 12) & 1) ? '#cfd8dc' : '#7f8c91';
      ctx.fillRect(x - 6, y - 3, 5, 1); ctx.fillRect(x + 1, y - 3, 5, 1);
      ctx.fillStyle = (Math.floor(time * 6) & 1) ? '#ff5a4a' : '#7a2a24'; ctx.fillRect(x - 1, y + 2, 2, 1);
    },
    shell(ctx, e) {
      const x = Math.round(e.x), y = Math.round(e.y);
      ctx.fillStyle = 'rgba(255,200,90,0.5)'; ctx.fillRect(Math.round(e.x - e.vx * 2), Math.round(e.y - e.vy * 2), 2, 2);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = '#fff6c8'; ctx.fillRect(x, y, 1, 1);
    },
    beam(ctx, e, sim, time) {
      const t = sim.terrain, x = e.x;
      if (e.t < 45) {                               // visée : réticule et colonne pointillée
        const a = 0.35 + 0.35 * Math.sin(time * 30);
        ctx.fillStyle = 'rgba(255,90,90,' + a.toFixed(2) + ')';
        for (let y = 0; y < t.h; y += 6) ctx.fillRect(x, y, 1, 3);
        ctx.strokeStyle = 'rgba(255,120,120,0.9)'; ctx.lineWidth = 1;
        ctx.strokeRect(x - 7.5, 20.5, 15, 15);
      } else {                                      // tir : colonne éblouissante qui s'éteint
        const k = Math.max(0, 1 - (e.t - 45) / 25);
        ctx.fillStyle = 'rgba(255,255,255,' + k.toFixed(2) + ')'; ctx.fillRect(x - 5, 0, 11, t.h);
        ctx.fillStyle = 'rgba(120,220,255,' + (k * 0.8).toFixed(2) + ')'; ctx.fillRect(x - 9, 0, 19, t.h);
      }
    },
    shield(ctx, e, sim, time) {
      const flick = 0.16 + 0.05 * Math.sin(time * 14), fade = Math.min(1, e.ttl / 40);
      ctx.fillStyle = 'rgba(110,220,255,' + (flick * fade).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(170,240,255,' + (0.8 * fade).toFixed(2) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.stroke();
    },
    zipline(ctx, e) {
      ctx.strokeStyle = '#dfe7ea'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
      ctx.fillStyle = '#17303a'; ctx.fillRect(e.x1 - 1, e.y1 - 2, 3, 3); ctx.fillRect(e.x2 - 1, e.y2 - 2, 3, 3);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(e.x1, e.y1 - 1, 1, 1);
    },
    mine(ctx, e, sim, time, visible) {
      if (!visible) return;
      ctx.fillStyle = '#17303a'; ctx.fillRect(e.x - 3, e.y - 1, 7, 2); ctx.fillRect(e.x - 2, e.y - 2, 5, 1);
      ctx.fillStyle = (Math.floor(time * 3) & 1) ? '#ff4a3a' : '#6a1f1a'; ctx.fillRect(e.x, e.y - 3, 1, 1);
    },
    tank(ctx, e, sim, time) {
      const x = e.x, y = e.y, f = e.dir;
      ctx.fillStyle = '#17303a'; ctx.fillRect(x - 9, y - 3, 18, 4);          // chenilles
      ctx.fillStyle = (Math.floor(e.ttl / 3) & 1) ? '#4a5a62' : '#5a6a72'; ctx.fillRect(x - 8, y - 2, 16, 2);
      ctx.fillStyle = e.owner ? '#a83a3a' : '#2e8fa3'; ctx.fillRect(x - 7, y - 7, 14, 4);   // caisse
      ctx.fillStyle = e.owner ? '#d8574a' : '#3fb6c9'; ctx.fillRect(x - 4, y - 10, 8, 3);   // tourelle
      ctx.fillStyle = '#17303a'; ctx.fillRect(f > 0 ? x + 4 : x - 12, y - 9, 8, 1);          // canon
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(x + f * 5 - 1, y - 6, 2, 1);
      for (let i = 0; i < e.riders.length; i++) { ctx.fillStyle = '#8ee3f2'; ctx.fillRect(x - 6 + i * 2, y - 11 + (i & 1), 1, 1); }
    }
  };

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
      this.theme = NS.Themes.get('desert');
      this.pal = null;
      this.decor = {};
      this.fog = null;
      this.disc = null;
    }

    /** Ajuste la résolution interne à la taille CSS (plafonnée pour les performances). */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
      this.cam.setViewport(rect.width, rect.height);
      this.fog = newCanvas(Math.max(8, Math.ceil(rect.width / 4)), Math.max(8, Math.ceil(rect.height / 4)));
    }

    /** Prépare tout ce qui dépend du niveau (thème, terrain, décor, fonds). */
    setLevel(sim) {
      const t = sim.terrain, def = sim.def;
      this.theme = NS.Themes.get(def.theme);
      this.buildPalette(this.theme);
      this.terrainCanvas = newCanvas(t.w, t.h);
      this.tctx = this.terrainCanvas.getContext('2d');
      this.img = this.tctx.createImageData(t.w, t.h);
      this.pix = new Uint32Array(this.img.data.buffer);
      this.buildCave(t);
      this.paintRegion(t, 0, 0, t.w - 1, t.h - 1);
      this.tctx.putImageData(this.img, 0, 0);
      t.takeDirty();
      this.buildSurfaces(t);
      this.buildBackground(def, this.theme);
      this.decor = {};
      for (const d of def.decor || []) if (!this.decor[d.type]) this.decor[d.type] = NS.Themes.makeDecor(d.type, newCanvas);
      if (!this.disc) {                                    // disque doux pour percer le brouillard
        this.disc = newCanvas(64, 64);
        const g = this.disc.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      }
    }

    /** Repeint tout le terrain (après une annulation ou un redémarrage). */
    invalidate(t) {
      this.paintRegion(t, 0, 0, t.w - 1, t.h - 1);
      this.tctx.putImageData(this.img, 0, 0);
      this.buildSurfaces(t);
      t.takeDirty();
    }

    buildPalette(th) {
      const P = (c) => pack(c), PA = (a) => a.map(pack);
      this.pal = {
        sand: PA(th.ground.base), band: PA(th.ground.band), sandTop: P(th.ground.top), sandLow: P(th.ground.low),
        rock: PA(th.rock.base), rockTop: P(th.rock.top), rockLow: P(th.rock.low),
        brick: P(th.brick[0]), mortar: P(th.brick[1]), brickTop: P(th.brick[2]),
        brickB: P(th.brickB[0]), mortarB: P(th.brickB[1]), brickTopB: P(th.brickB[2]),
        water: PA(th.water.base), waterTop: P(th.water.top), lava: PA(th.lava.base), lavaTop: P(th.lava.top),
        cave: PA(th.cave.base), caveShade: P(th.cave.shade)
      };
    }

    /**
     * Fond de paroi : tout pixel situé sous la première matière solide de sa
     * colonne (au chargement) est "souterrain". Une fois creusé, il montre
     * un fond sombre au lieu du ciel.
     */
    buildCave(t) {
      this.cave = new Uint8Array(t.w * t.h);
      for (let x = 0; x < t.w; x++) {
        let under = false;
        for (let y = 0; y < t.h; y++) {
          const m = t.data[y * t.w + x];
          if (m === M.SAND || m === M.ROCK || m === M.BRICK || m === M.BRICK_B) under = true;
          if (under) this.cave[y * t.w + x] = 1;
        }
      }
    }

    /** Couleur de chaque pixel d'une zone, avec éclairage de surface et strates. */
    paintRegion(t, x0, y0, x1, y1) {
      const pix = this.pix, w = t.w, d = t.data, P = this.pal;
      const solidish = (m) => m === M.SAND || m === M.ROCK || m === M.BRICK || m === M.BRICK_B;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const m = d[y * w + x];
          let c = 0;
          const up = y > 0 ? d[(y - 1) * w + x] : M.ROCK;
          if (m === M.AIR) {
            if (this.cave[y * w + x]) c = solidish(up) ? P.caveShade : P.cave[noise(x, y) & 3];
          } else {
            const n = noise(x, y), k = n & 3;
            const down = y < t.h - 1 ? d[(y + 1) * w + x] : M.ROCK;
            const open = (v) => v === M.AIR || v === M.WATER || v === M.LAVA;
            switch (m) {
              case M.SAND:
                if (open(up)) c = P.sandTop;
                else if (open(down) && down === M.AIR) c = P.sandLow;
                else c = ((((y >> 3) + ((n >> 8) & 1)) & 1) ? P.band : P.sand)[k];
                break;
              case M.ROCK:
                c = open(up) ? P.rockTop : (down === M.AIR ? P.rockLow : P.rock[k]);
                break;
              case M.BRICK: case M.BRICK_B: {
                const row = y & 3, off = ((y >> 2) & 1) * 3, b = m === M.BRICK;
                if (up === M.AIR) c = b ? P.brickTop : P.brickTopB;
                else if (row === 3 || ((x + off) & 5) === 0) c = b ? P.mortar : P.mortarB;
                else c = b ? P.brick : P.brickB;
                break;
              }
              case M.WATER: c = up === M.AIR ? P.waterTop : P.water[k]; break;
              case M.LAVA: c = up === M.AIR ? P.lavaTop : P.lava[k]; break;
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
          if ((m === M.WATER || m === M.LAVA) && t.data[(y - 1) * t.w + x] === M.AIR) this.surfaces.push({ x, y, lava: m === M.LAVA });
        }
      }
    }

    /** Ciel, étoiles, planète, couches de silhouettes en parallaxe. */
    buildBackground(def, th) {
      const W = def.width, H = def.height;
      const rng = new NS.RNG((def.seed || 1) ^ 0x9e3779b9);
      const sky = newCanvas(W, H), sg = sky.getContext('2d');
      const grad = sg.createLinearGradient(0, 0, 0, H);
      for (const [o, col] of th.sky) grad.addColorStop(o, col);
      sg.fillStyle = grad; sg.fillRect(0, 0, W, H);
      for (let i = 0; i < th.stars; i++) {                     // étoiles
        const a = 0.3 + rng.next() * 0.7;
        sg.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
        sg.fillRect(rng.int(0, W - 1), rng.int(0, H * 0.8), rng.next() < 0.15 ? 2 : 1, 1);
      }
      if (th.planet) {                                         // planète bleue et son croissant
        sg.fillStyle = '#1d3f8a'; sg.beginPath(); sg.arc(W * 0.72, H * 0.34, 54, 0, Math.PI * 2); sg.fill();
        sg.fillStyle = '#3a78d0'; sg.beginPath(); sg.arc(W * 0.72 - 8, H * 0.34 - 8, 44, 0, Math.PI * 2); sg.fill();
        sg.fillStyle = 'rgba(255,255,255,0.35)'; sg.fillRect(W * 0.72 - 30, H * 0.34 - 26, 22, 3); sg.fillRect(W * 0.72 - 4, H * 0.34 + 6, 26, 3);
      }
      if (th.aurora) {                                         // aurore boréale : bandes vertes translucides
        for (let i = 0; i < 5; i++) {
          sg.fillStyle = 'rgba(120,255,190,' + (0.05 + rng.next() * 0.06).toFixed(3) + ')';
          const y = H * (0.08 + i * 0.045);
          for (let x = 0; x < W; x += 4) sg.fillRect(x, y + Math.sin(x * 0.012 + i) * 14, 4, 22);
        }
      }
      this.sky = sky;
      this.layers = th.layers.map((s) => {
        const c = newCanvas(W, H), g = c.getContext('2d');
        g.fillStyle = s.col;
        if (s.kind === 'city' || s.kind === 'modules') {       // immeubles ou modules : rectangles et antennes
          let x = 0;
          while (x < W) {
            const bw = rng.int(14, s.kind === 'city' ? 40 : 56), bh = rng.int(s.amp * 0.3, s.amp);
            const top = Math.round(H * s.base - bh);
            g.fillRect(x, top, bw, H - top);
            if (s.kind === 'city' && rng.next() < 0.4) g.fillRect(x + bw - 5, top - rng.int(3, 8), 3, 8);   // pan cassé
            if (s.kind === 'modules') { if (rng.next() < 0.5) g.fillRect(x + (bw >> 1), top - 10, 1, 10); g.fillRect(x - 3, top + 6, bw + 6, 2); }
            x += bw + rng.int(0, 6);
          }
          return { canvas: c, f: s.f };
        }
        const p1 = rng.next() * 6, p2 = rng.next() * 6, p3 = rng.next() * 6;
        for (let x = 0; x < W; x++) {
          let v = Math.sin(x * 0.006 + p1) * 0.55 + Math.sin(x * 0.015 + p2) * 0.3 + Math.sin(x * 0.037 + p3) * 0.15;
          if (s.kind === 'peaks') v = 1 - Math.abs(v) * 1.6;
          const y = Math.round(H * s.base - v * s.amp);
          g.fillRect(x, y, 1, H - y);
        }
        return { canvas: c, f: s.f };
      });
    }

    /* ------------------------------ Image ------------------------------ */

    /**
     * @param view {time, hoverId, hoverOk, aimAngle, overlay(ctx)}
     */
    draw(sim, fx, view) {
      const ctx = this.ctx, cam = this.cam, t = sim.terrain, def = sim.def, th = this.theme;
      const s = cam.zoom * this.dpr;
      const time = view.time;
      this.me = view.me | 0;                                   // camp du joueur local (le camp 1 en ligne, pour l'invité)

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
      ctx.fillStyle = th.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);
      ctx.imageSmoothingEnabled = false;

      // Rectangle visible du monde : on ne recopie que ces pixels.
      const vx = Math.max(0, Math.floor(cam.x)), vy = Math.max(0, Math.floor(cam.y));
      const vw = Math.min(def.width - vx, Math.ceil(cam.vw / cam.zoom) + 2);
      const vh = Math.min(def.height - vy, Math.ceil(cam.vh / cam.zoom) + 2);
      this.view = { vx, vy, vw, vh };
      this.blit(ctx, this.sky, 0);
      this.drawSun(ctx, def, cam, th);
      for (const L of this.layers) this.blit(ctx, L.canvas, Math.round(cam.x * (1 - L.f)));

      // Décor derrière le terrain.
      for (const d of def.decor || []) {
        const img = this.decor[d.type];
        if (img && d.x > vx - 12 && d.x < vx + vw + 12) ctx.drawImage(img, d.x - 6, d.y - 18);
      }

      this.blit(ctx, this.terrainCanvas, 0);
      this.drawSurfaces(ctx, time);

      for (const p of sim.players) { this.drawHatch(ctx, sim, p, time); this.drawExit(ctx, p, time); this.drawCannon(ctx, p, view); }
      this.drawTraps(ctx, sim, time);

      for (const e of sim.entities) {
        const draw = ENTITY_DRAW[e.kind];
        if (!draw) continue;
        const vis = e.owner === this.me || sim.canSee(this.me, e.x !== undefined ? e.x : e.x1, e.y !== undefined ? e.y : e.y1);
        if (vis || e.kind === 'beam') draw(ctx, e, sim, time, vis);
      }

      // Bidules.
      const F = NS.Sprites.frames;
      for (const b of sim.bidules) {
        if (b.state === 'rider') continue;
        if (b.owner !== this.me && !sim.canSee(this.me, b.x, b.y)) continue;      // adversaire dans le brouillard
        const f = F[b.owner][NS.Sprites.frameFor(b)];
        const img = b.dir >= 0 ? f.r : f.l;
        const px = Math.round(b.x) - 4, py = Math.round(b.y) - 9;
        if (b.floating) {
          ctx.drawImage(NS.Sprites.parachute, px - 3, py - 6);
          ctx.fillStyle = '#17303a';
          ctx.fillRect(px + 1, py - 1, 1, 1); ctx.fillRect(px + 6, py - 1, 1, 1);
        }
        if (b.state === 'jet') {                                          // flamme du jetpack
          ctx.fillStyle = (b.t & 1) ? '#ffd23f' : '#ff7a1a';
          ctx.fillRect(px + (b.dir > 0 ? 0 : 6), py + 4, 2, 4 + (b.t & 1));
        } else if (b.state === 'zip') {                                   // poulie sur le câble
          ctx.fillStyle = '#17303a'; ctx.fillRect(px + 3, py - 4, 2, 2);
        } else if (b.state === 'grapple' && b.path) {
          const end = b.path[b.path.length - 1];
          ctx.strokeStyle = '#dfe7ea'; ctx.lineWidth = 1 / s * this.dpr;
          ctx.beginPath(); ctx.moveTo(b.x, b.y - 8); ctx.lineTo(end[0], end[1] - 9); ctx.stroke();
        }
        ctx.drawImage(img, px, py);
        if (b.bomb > 0) NS.Sprites.drawDigit(ctx, Math.ceil(b.bomb / NS.C.TICK_RATE), px + 3, py - 8);
        else if (b.climber && !b.floater) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(px + 3, py - 2, 2, 1); }
        else if (b.floater && !b.floating) { ctx.fillStyle = '#e8553c'; ctx.fillRect(px + 3, py - 2, 2, 1); }
      }

      fx.draw(ctx);

      // Reconnaissance : balayage lumineux pendant les 20 s.
      const me = sim.players[this.me];
      if (sim.tick < me.revealUntil) {
        const vwW = cam.vw / cam.zoom, sx = cam.x + ((time * 90) % vwW);
        ctx.fillStyle = 'rgba(120,240,255,0.35)'; ctx.fillRect(sx, cam.y, 2, cam.vh / cam.zoom);
        NS.Renderer.drawReconDrone(ctx, sx, cam.y + 14, time);
      }

      // Survol : cadre autour du Bidule visé.
      if (view.hoverId) {
        const b = sim.bidules.find((x) => x.id === view.hoverId);
        if (b) {
          ctx.strokeStyle = view.hoverOk ? '#fff6a8' : '#ff7a6a';
          ctx.lineWidth = 1 / s * this.dpr;
          ctx.strokeRect(Math.round(b.x) - 6.5, Math.round(b.y) - 11.5, 13, 14);
        }
      }
      if (view.overlay) view.overlay(ctx, s);

      // Brouilleur adverse : parasites sur l'écran.
      if (me.jammedUntil > sim.tick) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(255,90,120,0.16)';
        for (let i = 0; i < 9; i++) ctx.fillRect(0, ((time * 700 + i * 137) % this.canvas.height) | 0, this.canvas.width, 2 + (i & 3));
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        for (let i = 0; i < 40; i++) ctx.fillRect(((i * 7919 + (time * 5000 | 0)) % this.canvas.width) | 0, ((i * 104729) % this.canvas.height) | 0, 3, 1);
      }

      if (sim.fog && sim.tick >= me.revealUntil) this.drawFog(sim, th);
    }

    /** Recopie la partie visible d'un canvas de la taille du monde, décalé de `ox` pixels. */
    blit(ctx, img, ox) {
      const v = this.view;
      const sx = Math.max(0, v.vx - ox), ex = Math.min(img.width, v.vx + v.vw - ox);
      if (ex <= sx) return;
      ctx.drawImage(img, sx, v.vy, ex - sx, v.vh, sx + ox, v.vy, ex - sx, v.vh);
    }

    drawSun(ctx, def, cam, th) {
      if (!th.sun.r) return;
      const x = def.width * th.sun.x + cam.x * 0.9, y = def.height * th.sun.y, c = th.sun.glow, r = th.sun.r;
      ctx.fillStyle = 'rgba(' + c.join(',') + ',0.25)'; ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(' + c.join(',') + ',0.45)'; ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    /** Trappe d'entrée : boîtier métallique dont les battants s'ouvrent. */
    drawHatch(ctx, sim, p, time) {
      const h = p.hatch;
      const open = Math.min(1, Math.max(0, (sim.tick - 15) / 20));
      const x = h.x - 14, y = h.y - 12;
      ctx.fillStyle = '#2b3a42'; ctx.fillRect(x, y, 28, 9);
      ctx.fillStyle = p.id ? '#8a4a4a' : '#4b6470'; ctx.fillRect(x, y, 28, 2);
      ctx.fillStyle = '#10181c'; ctx.fillRect(x + 4, y + 6, 20, 3);
      const leaf = Math.round(10 * (1 - open));
      ctx.fillStyle = '#6a8794';
      ctx.fillRect(x + 4, y + 6, leaf, 3); ctx.fillRect(x + 24 - leaf, y + 6, leaf, 3);
      ctx.fillStyle = (Math.floor(time * 4) & 1) ? '#ffd23f' : '#7a5f10';
      ctx.fillRect(x + 2, y + 3, 2, 2); ctx.fillRect(x + 24, y + 3, 2, 2);
    }

    /** Porte de sortie : arche de pierre avec un cœur lumineux animé (fanion aux couleurs du camp). */
    drawExit(ctx, p, time) {
      const e = p.exit, x = e.x - 10, y = e.y - 21;
      ctx.fillStyle = '#7a5a48'; ctx.fillRect(x, y, 20, 24);
      ctx.fillStyle = '#9a7660'; ctx.fillRect(x, y, 20, 3); ctx.fillRect(x, y, 3, 24);
      const g = 0.6 + 0.4 * Math.sin(time * 5);
      ctx.fillStyle = 'rgb(' + Math.round(255 * g) + ',' + Math.round(214 * g) + ',' + Math.round(90 * g) + ')';
      ctx.fillRect(x + 4, y + 6, 12, 18);
      ctx.fillStyle = '#fff6c8'; ctx.fillRect(x + 7, y + 9, 6, 15);
      ctx.fillStyle = p.id ? '#d8574a' : '#3fb6c9'; ctx.fillRect(x + 9, y - 6, 1, 6); ctx.fillRect(x + 10, y - 6, 5, 3);
    }

    /** Emplacement du canon César : base et tube incliné selon l'angle de visée. */
    drawCannon(ctx, p, view) {
      if (!p.cannon || !p.weapons.cannon) return;
      const c = p.cannon, ang = p.id === this.me && view.aimAngle != null ? view.aimAngle : 45;
      ctx.fillStyle = '#17303a'; ctx.fillRect(c.x - 6, c.y - 3, 12, 4);
      ctx.fillStyle = p.id ? '#a83a3a' : '#2e8fa3'; ctx.fillRect(c.x - 5, c.y - 5, 10, 3);
      const bx = c.x, by = c.y - 8, L = 11;
      ctx.strokeStyle = '#17303a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + c.dir * L * NS.cosDeg(ang), by - L * NS.sinDeg(ang)); ctx.stroke();
      ctx.strokeStyle = '#8fa3ad'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + c.dir * L * NS.cosDeg(ang), by - L * NS.sinDeg(ang)); ctx.stroke();
    }

    /** Mines cachées : visibles seulement sous reconnaissance (ou une fois désamorcées, jamais). */
    drawTraps(ctx, sim, time) {
      if (sim.tick >= sim.players[this.me].revealUntil) return;
      for (const tr of sim.traps) {
        if (!tr.alive) continue;
        ctx.fillStyle = '#17303a'; ctx.fillRect(tr.x - 3, tr.y - 1, 7, 2); ctx.fillRect(tr.x - 2, tr.y - 2, 5, 1);
        ctx.fillStyle = (Math.floor(time * 6) & 1) ? '#ff3a2a' : '#ffd23f'; ctx.fillRect(tr.x, tr.y - 3, 1, 1);
        ctx.strokeStyle = 'rgba(255,80,60,0.6)'; ctx.lineWidth = 0.7;
        ctx.strokeRect(tr.x - 6.5, tr.y - 8.5, 13, 10);
      }
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

    /**
     * Brouillard de guerre : un canvas basse résolution (1/4) est rempli de
     * ténèbres, percé de disques doux autour des sources de vision du joueur
     * (Bidules, trappe, sortie, drones, chars), puis agrandi avec lissage.
     */
    drawFog(sim, th) {
      const cam = this.cam, f = this.fog, g = f.getContext('2d'), k = cam.zoom / 4;
      const R = 90 * k * 2;                                    // diamètre d'un disque de vision
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, f.width, f.height);
      g.fillStyle = th.fogTint;
      g.fillRect(0, 0, f.width, f.height);
      g.globalCompositeOperation = 'destination-out';
      const hole = (x, y, mul) => { const r = R * (mul || 1); g.drawImage(this.disc, (x - cam.x) * k - r / 2, (y - cam.y) * k - r / 2, r, r); };
      const me = sim.players[this.me];
      hole(me.hatch.x, me.hatch.y, 0.9); hole(me.exit.x, me.exit.y - 8, 0.9);
      for (const b of sim.bidules) if (b.owner === this.me && b.state !== 'rider') hole(b.x, b.y - 5, 1);
      for (const e of sim.entities) if (e.owner === this.me && (e.kind === 'drone' || e.kind === 'tank')) hole(e.x, e.y, 0.8);
      g.globalCompositeOperation = 'source-over';
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(f, 0, 0, f.width, f.height, 0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
    }
  }

  /** Petit drone de reconnaissance qui balaie l'écran pendant la révélation. */
  Renderer.drawReconDrone = function (ctx, x, y, time) {
    ctx.fillStyle = '#17303a'; ctx.fillRect(x - 5, y - 1, 10, 3);
    ctx.fillStyle = '#6df0ff'; ctx.fillRect(x - 3, y - 1, 6, 2);
    ctx.fillStyle = (Math.floor(time * 14) & 1) ? '#cfd8dc' : '#7f8c91';
    ctx.fillRect(x - 8, y - 3, 6, 1); ctx.fillRect(x + 2, y - 3, 6, 1);
  };

  NS.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
