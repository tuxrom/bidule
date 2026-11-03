/**
 * terrain.js
 * Le décor est un bitmap : un octet (matériau) par pixel. Creuser, miner,
 * exploser ou bâtir modifient réellement ce tableau. Le rendu n'en est qu'un
 * miroir : le terrain signale les zones modifiées (rectangle "sale") et le
 * moteur de rendu ne repeint que celles-ci.
 *
 * Aucune dépendance au DOM : la classe tourne telle quelle sous Node pour les tests.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const M = NS.M, SOLID = NS.SOLID, DIGGABLE = NS.DIGGABLE;

  /**
   * Solidité selon le camp qui regarde. Les briques d'un camp ne sont solides
   * que pour ce camp : les escaliers de l'un ne bloquent jamais l'autre (sinon
   * deux armées qui bâtissent en sens inverse se verrouilleraient). Index 2 :
   * vue neutre (obus, drones, explosions) pour qui tout est solide.
   */
  const VIEW = [SOLID.slice(), SOLID.slice(), SOLID];
  VIEW[0][M.BRICK_B] = 0;
  VIEW[1][M.BRICK] = 0;

  class Terrain {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.data = new Uint8Array(w * h);
      this.dirty = null;   // {x0,y0,x1,y1} à repeindre, ou null
      this.solid = VIEW[2];  // table de solidité active (voir setViewer)
      this.version = 0;    // incrémenté à chaque modification
    }

    /* ------------------------------ Lecture ------------------------------ */

    /** Choisit le point de vue des tests de collision : 0, 1 (camp) ou 2 (neutre). */
    setViewer(v) { this.solid = VIEW[v] || VIEW[2]; }

    /** Matériau en (x,y). Hors limites : air. */
    get(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return M.AIR;
      return this.data[y * this.w + x];
    }
    isSolid(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      return this.solid[this.data[y * this.w + x]] === 1;
    }
    /** Vrai si la colonne x est libre sur `hgt` lignes, pied en yBottom. */
    freeColumn(x, yBottom, hgt) {
      if (x < 0 || x >= this.w) return true;
      for (let y = yBottom - hgt + 1; y <= yBottom; y++) {
        if (y >= 0 && y < this.h && this.solid[this.data[y * this.w + x]] === 1) return false;
      }
      return true;
    }

    /* ----------------------------- Écriture ------------------------------ */

    set(x, y, m) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.data[y * this.w + x] = m;
    }

    markDirty(x0, y0, x1, y1) {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(this.w - 1, x1); y1 = Math.min(this.h - 1, y1);
      if (x1 < x0 || y1 < y0) return;
      this.version++;
      const d = this.dirty;
      if (!d) this.dirty = { x0, y0, x1, y1 };
      else {
        if (x0 < d.x0) d.x0 = x0;
        if (y0 < d.y0) d.y0 = y0;
        if (x1 > d.x1) d.x1 = x1;
        if (y1 > d.y1) d.y1 = y1;
      }
    }
    markAllDirty() { this.markDirty(0, 0, this.w - 1, this.h - 1); }
    /** Récupère puis efface le rectangle sale. */
    takeDirty() { const d = this.dirty; this.dirty = null; return d; }

    /**
     * Efface (en air) les pixels destructibles d'un disque.
     * Si `rng` est fourni, le bord du cratère est irrégulier (déterministe).
     * Avec `breakRock`, la roche cède aussi (seuls l'eau et la lave restent).
     * @returns {number} pixels retirés
     */
    carveCircle(cx, cy, r, rng, breakRock) {
      const r2 = r * r, inner = (r - 2) * (r - 2);
      let n = 0;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= this.h) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= this.w) continue;
          const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          if (rng && d2 > inner && rng.next() < 0.4) continue;
          const i = y * this.w + x;
          const m = this.data[i];
          if (DIGGABLE[m] || (breakRock && m === M.ROCK)) { this.data[i] = M.AIR; n++; }
        }
      }
      if (n) this.markDirty(cx - r, cy - r, cx + r, cy + r);
      return n;
    }

    /** Perce une colonne de largeur 2*half+1 sur toute la hauteur, roche comprise (frappe orbitale). */
    carveColumn(x, half) {
      let n = 0;
      for (let y = 0; y < this.h; y++) {
        for (let xx = Math.max(0, x - half); xx <= Math.min(this.w - 1, x + half); xx++) {
          const i = y * this.w + xx, m = this.data[i];
          if (m === M.SAND || m === M.ROCK || m === M.BRICK) { this.data[i] = M.AIR; n++; }
        }
      }
      if (n) this.markDirty(x - half, 0, x + half, this.h - 1);
      return n;
    }

    /** Cherche une position de pieds près de (x, y) : colonne libre et sol dessous. */
    findStandable(x, y, radius) {
      let best = null, bd = Infinity;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = x + dx, py = y + dy, d = dx * dx + dy * dy;
          if (d >= bd || px < 1 || px >= this.w - 1 || py < 12 || py >= this.h - 2) continue;
          if (this.isSolid(px, py + 1) && this.freeColumn(px, py, 10)) { best = { x: px, y: py }; bd = d; }
        }
      }
      return best;
    }

    /** Efface un rectangle (bornes incluses) de pixels destructibles. */
    carveRect(x0, y0, x1, y1) {
      let n = 0;
      for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
          const i = y * this.w + x;
          if (DIGGABLE[this.data[i]]) { this.data[i] = M.AIR; n++; }
        }
      }
      if (n) this.markDirty(x0, y0, x1, y1);
      return n;
    }

    /** Compte les pixels d'un disque dont le matériau vérifie `table`. */
    circleCount(cx, cy, r, table) {
      let n = 0;
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r * r && table[this.get(x, y)]) n++;
        }
      }
      return n;
    }

    /** Compte les pixels d'un rectangle dont le matériau vérifie `table`. */
    countRect(x0, y0, x1, y1, table) {
      let n = 0;
      for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
          if (table[this.data[y * this.w + x]]) n++;
        }
      }
      return n;
    }

    /** Pose un matériau sur un rectangle ; `onlyAir` protège le décor existant (voir ci-dessous). */
    fillRect(x0, y0, x1, y1, mat, onlyAir) {
      let n = 0;
      for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
          const i = y * this.w + x;
          // `onlyAir` protège le décor, sauf les briques de l'AUTRE camp (traversables pour moi : j'y bâtis).
          const cur = this.data[i];
          if (onlyAir && cur !== M.AIR && !((cur === M.BRICK || cur === M.BRICK_B) && cur !== mat)) continue;
          this.data[i] = mat; n++;
        }
      }
      if (n) this.markDirty(x0, y0, x1, y1);
      return n;
    }

    /* --------------------------- Rasterisation --------------------------- */
    // Utilisée par le chargeur de niveaux : tout est en entiers, donc identique
    // sur toutes les machines.

    paintRect(x, y, w, h, mat) {
      this.fillRect(x, y, x + w - 1, y + h - 1, mat, false);
    }

    paintEllipse(cx, cy, rx, ry, mat) {
      for (let y = -ry; y <= ry; y++) {
        const k = 1 - (y * y) / (ry * ry);
        if (k < 0) continue;
        const dx = Math.floor(rx * Math.sqrt(k));
        this.fillRect(cx - dx, cy + y, cx + dx, cy + y, mat, false);
      }
    }

    /** Polygone plein (règle pair-impair, balayage par lignes). */
    paintPoly(pts, mat) {
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      minY = Math.max(0, Math.floor(minY)); maxY = Math.min(this.h - 1, Math.ceil(maxY));
      for (let y = minY; y <= maxY; y++) {
        const xs = [], cy = y + 0.5;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy)) {
            xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
          }
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const xa = Math.ceil(xs[i] - 0.5), xb = Math.ceil(xs[i + 1] - 0.5) - 1;
          if (xb >= xa) this.fillRect(xa, y, xb, y, mat, false);
        }
      }
    }

    /**
     * Profil d'altitude : la polyligne donne la hauteur de surface en fonction
     * de x ; tout ce qui est en dessous (jusqu'à `bottom`) est rempli.
     */
    paintHeights(pts, mat, bottom) {
      bottom = bottom == null ? this.h - 1 : bottom;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [xa, ya] = pts[i], [xb, yb] = pts[i + 1];
        for (let x = xa; x <= xb; x++) {
          const t = xb === xa ? 0 : (x - xa) / (xb - xa);
          const top = Math.round(ya + (yb - ya) * t);
          this.fillRect(x, top, x, bottom, mat, false);
        }
      }
    }

    /**
     * Construit le terrain depuis une image de masque (ImageData-like).
     * `palette` associe une couleur 0xRRGGBB à un matériau ; les pixels
     * transparents ou inconnus deviennent de l'air.
     */
    paintMask(img, palette) {
      for (let y = 0; y < Math.min(img.height, this.h); y++) {
        for (let x = 0; x < Math.min(img.width, this.w); x++) {
          const o = (y * img.width + x) * 4;
          if (img.data[o + 3] < 128) continue;
          const rgb = (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
          const m = palette[rgb];
          if (m !== undefined) this.data[y * this.w + x] = m;
        }
      }
      this.markAllDirty();
    }

    /* ------------------------- Instantanés / hash ------------------------ */

    snapshot() { return this.data.slice(); }
    restore(buf) { this.data.set(buf); this.markAllDirty(); }

    /** Empreinte FNV-1a du bitmap (comparaison de rediffusions). */
    hash() {
      let h = 0x811c9dc5;
      const d = this.data;
      for (let i = 0; i < d.length; i++) {
        h ^= d[i];
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    }
  }

  NS.Terrain = Terrain;
})(typeof window !== 'undefined' ? window : globalThis);
