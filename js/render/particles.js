/**
 * particles.js
 * Particules purement visuelles (explosions, poussière, étincelles).
 * Elles utilisent Math.random() : elles ne font PAS partie de la simulation
 * et ne peuvent donc pas la désynchroniser. Un tampon de taille fixe évite
 * toute allocation pendant le jeu.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  const MAX = 700;
  const SAND = ['#e8b86a', '#d9a441', '#c98f3a', '#f2cd8a'];
  const FIRE = ['#ffe08a', '#ffb300', '#ff6a1a', '#d94a10'];
  const SMOKE = ['#6b5a55', '#8a7770', '#4a3f3c'];
  const METAL = ['#cfd8dc', '#8fa3ad', '#ffd23f', '#3fb6c9'];
  const WATER = ['#d6f0ff', '#8fd0ff', '#4aa3ea'];
  const SPARK = ['#fff1a8', '#ffd23f', '#ffffff', '#8ee3f2'];

  class Particles {
    constructor() {
      this.n = 0;
      this.x = new Float32Array(MAX); this.y = new Float32Array(MAX);
      this.vx = new Float32Array(MAX); this.vy = new Float32Array(MAX);
      this.life = new Float32Array(MAX); this.size = new Uint8Array(MAX);
      this.grav = new Float32Array(MAX); this.col = new Array(MAX);
      this.rings = [];   // ondes de choc {x, y, t, max}
    }

    add(x, y, vx, vy, life, size, col, grav) {
      if (this.n >= MAX) return;
      const i = this.n++;
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      this.life[i] = life; this.size[i] = size; this.col[i] = col; this.grav[i] = grav;
    }

    burst(x, y, count, speed, life, palette, size, grav, up) {
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
        this.add(x, y, Math.cos(a) * s, Math.sin(a) * s - (up || 0), life * (0.6 + Math.random() * 0.6),
          size, palette[(Math.random() * palette.length) | 0], grav);
      }
    }

    /** Transforme un événement de la simulation en effets visuels. */
    handle(ev) {
      const { type, x, y } = ev;
      switch (type) {
        case 'explode':
          this.burst(x, y, 60, 150, 0.8, FIRE, 2, 160, 30);
          this.burst(x, y, 30, 90, 1.1, SMOKE, 3, -20, 10);
          this.burst(x, y, 40, 120, 0.9, SAND, 1, 220, 40);
          this.rings.push({ x, y, t: 0, max: 0.35 });
          break;
        case 'die':
          if (ev.extra === 'drown') this.burst(x, y - 2, 16, 70, 0.6, WATER, 1, 180, 50);
          else if (ev.extra === 'burn') this.burst(x, y - 3, 22, 80, 0.7, FIRE, 1, 60, 40);
          else if (ev.extra === 'splat') this.burst(x, y - 3, 22, 90, 0.8, METAL, 1, 240, 40);
          else if (ev.extra === 'dismiss') this.burst(x, y - 5, 14, 50, 0.6, METAL, 1, -30, 30);
          break;
        case 'saved':
          this.burst(x, y - 5, 18, 60, 0.9, SPARK, 1, -40, 30);
          break;
        case 'dig':
          for (let k = 0; k < 4; k++) this.add(x + (Math.random() - 0.5) * 8, y, (Math.random() - 0.5) * 30, -10 - Math.random() * 20, 0.5, 1, SAND[k & 3], 140);
          break;
        case 'bash':
          for (let k = 0; k < 4; k++) this.add(x, y + (Math.random() - 0.5) * 8, ev.extra * (20 + Math.random() * 30), -10 - Math.random() * 25, 0.5, 1, SAND[k & 3], 150);
          break;
        case 'mine':
          this.burst(x, y, 8, 40, 0.5, SAND, 1, 150, 15);
          break;
        case 'brick':
          this.burst(x, y, 4, 25, 0.35, SAND, 1, 60, 5);
          break;
        case 'spawn':
          this.burst(x, y, 4, 25, 0.4, SAND, 1, 20, 0);
          break;
        case 'clink':
          this.burst(x, y - 4, 8, 70, 0.3, SPARK, 1, 120, 20);
          break;
        case 'chute':
          this.burst(x, y - 8, 8, 40, 0.4, SPARK, 1, 10, 10);
          break;
      }
    }

    update(dt) {
      for (let i = 0; i < this.n;) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {         // retrait par échange avec le dernier
          const l = --this.n;
          this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
          this.life[i] = this.life[l]; this.size[i] = this.size[l]; this.grav[i] = this.grav[l]; this.col[i] = this.col[l];
          continue;
        }
        this.vy[i] += this.grav[i] * dt;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        i++;
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        this.rings[i].t += dt;
        if (this.rings[i].t > this.rings[i].max) this.rings.splice(i, 1);
      }
    }

    draw(ctx) {
      for (let i = 0; i < this.n; i++) {
        ctx.fillStyle = this.col[i];
        const s = this.size[i];
        ctx.fillRect(Math.round(this.x[i]), Math.round(this.y[i]), s, s);
      }
      for (const r of this.rings) {
        const k = r.t / r.max;
        ctx.strokeStyle = 'rgba(255,240,180,' + (1 - k).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 4 + k * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    clear() { this.n = 0; this.rings.length = 0; }
  }

  NS.Particles = Particles;
})(typeof window !== 'undefined' ? window : globalThis);
