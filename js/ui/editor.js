/**
 * editor.js
 * Éditeur de niveaux : on dessine le terrain au pinceau (sable, roche, eau, lave, gomme), on place la trappe et la
 * sortie, on règle effectif, objectif et temps, on TESTE tout de suite, puis on partage par code.
 *
 * Deux codes : le code long (tout le niveau dans une chaîne, copiable partout, fonctionne hors ligne) et le code
 * court NIVxxxxxx (le serveur garde le long et le rend à qui le demande). Le décodage (Loader.decodeLevel) borne
 * toutes les valeurs : un code reçu d'un inconnu ne peut rien d'autre que décrire un niveau.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  const $ = (id) => document.getElementById(id);
  const M = NS.M;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W = 600, H = 300;
  const TOOLS = [['sand', 'Sable', M.SAND], ['rock', 'Roche', M.ROCK], ['water', 'Eau', M.WATER], ['lava', 'Lave', M.LAVA], ['air', 'Gomme', M.AIR], ['hatch', 'Trappe', -1], ['exit', 'Sortie', -2]];
  const COLORS = { [M.AIR]: [150, 205, 235], [M.SAND]: [226, 176, 98], [M.ROCK]: [110, 72, 70], [M.BRICK]: [204, 114, 62], [M.WATER]: [46, 125, 214], [M.LAVA]: [255, 106, 26] };

  function blank() {
    const data = new Uint8Array(W * H);
    const t = { data, w: W, h: H };
    const rect = (x, y, w, h, m) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) data[j * W + i] = m; };
    rect(0, 200, W, 100, M.SAND); rect(0, 0, 6, H, M.ROCK); rect(W - 6, 0, 6, H, M.ROCK); rect(0, H - 8, W, 8, M.ROCK);
    return {
      data, name: 'Mon niveau', theme: 'desert', count: 20, goal: 50, time: 240, tool: 'sand', brush: 6, history: [],
      hatch: { x: 50, y: 170, dir: 1 }, exit: { x: W - 50, y: 199 }
    };
  }

  function install(Game) {
    const P = Game.prototype;

    P.apiBase = function () {
      const u = this.serverUrl && this.serverUrl();
      if (u) return u.replace(/^ws/, 'http').replace(/\/ws$/, '');
      return /^https?:$/.test(location.protocol) ? location.origin : '';
    };

    P.showEditor = function () {
      if (!this.ed) this.ed = blank();
      const ed = this.ed;
      document.body.dataset.theme = ed.theme;
      const tools = TOOLS.map(([k, label]) => '<button class="btn tool-btn' + (ed.tool === k ? ' on' : '') + '" data-action="ed" data-arg="tool:' + k + '">' + label + '</button>').join('');
      const themes = ['desert', 'ruins', 'arctic', 'orbital'].map((k) => '<option value="' + k + '"' + (ed.theme === k ? ' selected' : '') + '>' + NS.Themes.get(k).name + '</option>').join('');
      this.openOverlay('<div class="card wide"><h2>Éditeur de niveaux</h2>' +
        '<div class="ed-tools">' + tools + '</div>' +
        '<canvas id="ed-canvas" width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="ed-opts"><label>Pinceau <input type="range" id="ed-brush" min="2" max="24" value="' + ed.brush + '"></label>' +
        '<label>Nom <input id="ed-name" maxlength="30" value="' + esc(ed.name) + '"></label>' +
        '<label>Univers <select id="ed-theme">' + themes + '</select></label>' +
        '<label>Bidules <input id="ed-count" type="number" min="1" max="60" value="' + ed.count + '"></label>' +
        '<label>Objectif % <input id="ed-goal" type="number" min="1" max="100" value="' + ed.goal + '"></label>' +
        '<label>Temps (s) <input id="ed-time" type="number" min="30" max="900" value="' + ed.time + '"></label></div>' +
        '<div class="row"><button class="btn" data-action="ed" data-arg="undo">Annuler</button><button class="btn" data-action="ed" data-arg="clear">Nouveau</button>' +
        '<button class="btn primary" data-action="ed" data-arg="test">Tester</button></div>' +
        '<div class="row"><button class="btn" data-action="ed" data-arg="copy">Copier le code</button><button class="btn" data-action="ed" data-arg="publish">Publier (code court)</button><button class="btn" data-action="ed" data-arg="link">Copier le lien</button></div>' +
        '<div class="row"><input id="ed-code" class="wide-input" placeholder="Coller un code de niveau ou NIV…"><button class="btn" data-action="ed" data-arg="load">Charger</button></div>' +
        '<div id="ed-msg" class="netstate"></div><div class="row"><button class="btn" data-action="title">Retour</button></div></div>');
      this.edBind();
      this.edDraw();
    };

    P.edMsg = function (t) { const e = $('ed-msg'); if (e) e.textContent = t; };

    P.edBind = function () {
      const ed = this.ed, cv = $('ed-canvas');
      const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(W - 1, Math.floor(((e.clientX - r.left) / r.width) * W))), y: Math.max(0, Math.min(H - 1, Math.floor(((e.clientY - r.top) / r.height) * H))) }; };
      let last = null, down = false;
      cv.onpointerdown = (e) => {
        cv.setPointerCapture(e.pointerId); down = true;
        const p = pos(e);
        const tool = TOOLS.find((t) => t[0] === ed.tool);
        ed.history.push(ed.data.slice()); if (ed.history.length > 15) ed.history.shift();
        if (tool[2] === -1) { ed.hatch.x = Math.max(12, Math.min(W - 12, p.x)); ed.hatch.y = p.y; down = false; this.edDraw(); return; }
        if (tool[2] === -2) {                                   // la sortie se pose sur le sol sous le doigt
          let y = p.y;
          const solid = (yy) => ed.data[yy * W + p.x] === M.SAND || ed.data[yy * W + p.x] === M.ROCK;
          while (y < H - 2 && !solid(y + 1)) y++;
          ed.exit.x = Math.max(12, Math.min(W - 12, p.x)); ed.exit.y = y; down = false; this.edDraw(); return;
        }
        last = p; this.edStamp(p.x, p.y, tool[2]); this.edDraw();
      };
      cv.onpointermove = (e) => {
        if (!down) return;
        const p = pos(e), tool = TOOLS.find((t) => t[0] === ed.tool);
        const n = Math.max(Math.abs(p.x - last.x), Math.abs(p.y - last.y), 1);   // relie deux positions : trait continu
        for (let i = 1; i <= n; i++) this.edStamp(Math.round(last.x + ((p.x - last.x) * i) / n), Math.round(last.y + ((p.y - last.y) * i) / n), tool[2]);
        last = p; this.edDraw();
      };
      cv.onpointerup = cv.onpointercancel = () => { down = false; };
      $('ed-brush').oninput = (e) => { ed.brush = Number(e.target.value); };
      $('ed-name').oninput = (e) => { ed.name = e.target.value; };
      $('ed-theme').onchange = (e) => { ed.theme = e.target.value; document.body.dataset.theme = ed.theme; };
      for (const [id, k] of [['ed-count', 'count'], ['ed-goal', 'goal'], ['ed-time', 'time']]) $(id).onchange = (e) => { ed[k] = Number(e.target.value); };
    };

    P.edStamp = function (cx, cy, mat) {
      const ed = this.ed, r = ed.brush, r2 = r * r;
      for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) ed.data[y * W + x] = mat;
      }
    };

    P.edDraw = function () {
      const ed = this.ed, cv = $('ed-canvas');
      if (!cv) return;
      const g = cv.getContext('2d'), img = g.createImageData(W, H);
      for (let i = 0; i < W * H; i++) { const c = COLORS[ed.data[i]] || COLORS[M.AIR]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
      g.putImageData(img, 0, 0);
      g.fillStyle = '#2b3a42'; g.fillRect(ed.hatch.x - 14, ed.hatch.y - 12, 28, 9); g.fillStyle = '#ffd23f'; g.fillRect(ed.hatch.x - 12, ed.hatch.y - 9, 3, 3);
      g.fillStyle = '#7a5a48'; g.fillRect(ed.exit.x - 10, ed.exit.y - 21, 20, 24); g.fillStyle = '#fff6c8'; g.fillRect(ed.exit.x - 5, ed.exit.y - 14, 10, 17);
    };

    P.edDef = function () {
      const ed = this.ed;
      const def = { name: ed.name.trim() || 'Niveau perso', theme: ed.theme, width: W, height: H, hatch: { x: ed.hatch.x, y: ed.hatch.y, dir: 1 }, exit: { x: ed.exit.x, y: ed.exit.y },
        count: ed.count, goal: ed.goal, timeLimit: ed.time, skills: { blocker: 3, builder: 6, digger: 3, miner: 3, basher: 4, climber: 3, floater: 3, bomber: 2 } };
      return def;
    };

    P.edAction = async function (arg) {
      const ed = this.ed, [cmd, v] = arg.split(':');
      switch (cmd) {
        case 'tool': ed.tool = v; document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('on', b.dataset.arg === 'tool:' + v)); break;
        case 'undo': if (ed.history.length) { ed.data.set(ed.history.pop()); this.edDraw(); } break;
        case 'clear': this.ed = blank(); this.showEditor(); break;
        case 'test': {
          const d = this.edDef(), t = { data: ed.data };
          if (ed.data[ed.hatch.y * W + ed.hatch.x] === M.SAND || ed.data[ed.hatch.y * W + ed.hatch.x] === M.ROCK) return this.edMsg('La trappe est dans la matière : place-la dans le vide.');
          const code = NS.Loader.encodeLevel(d, t);
          this.startCustom(NS.Loader.decodeLevel(code), code);                 // exactement ce que verrait quelqu'un qui recevrait le code
          break;
        }
        case 'copy': {
          const code = NS.Loader.encodeLevel(this.edDef(), { data: ed.data });
          $('ed-code').value = code;
          try { await navigator.clipboard.writeText(code); this.edMsg('Code copié (' + code.length + ' caractères). Colle-le dans la case « Charger » d\'un autre appareil.'); }
          catch (e) { $('ed-code').select(); this.edMsg('Code affiché ci-dessous : copie-le à la main.'); }
          break;
        }
        case 'publish': {
          const base = this.apiBase();
          if (!base) return this.edMsg('Pas de serveur : utilise « Copier le code » (fonctionne hors ligne).');
          const code = NS.Loader.encodeLevel(this.edDef(), { data: ed.data });
          try {
            const r = await fetch(base + '/api/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || r.status);
            $('ed-code').value = j.id; this.edMsg('Publié. Code court : ' + j.id + ' (à donner à tes amis).');
          } catch (e) { this.edMsg('Publication impossible : ' + e.message); }
          break;
        }
        case 'link': {                                         // lien direct : …#niveau=NIVxxxx si publié, sinon le code long
          const typed = ($('ed-code').value || '').trim();
          const ref = /^NIV[0-9A-Z]{3,9}$/i.test(typed) ? typed.toUpperCase() : NS.Loader.encodeLevel(this.edDef(), { data: ed.data });
          this.shareLink('niveau=' + ref, 'du niveau');
          this.edMsg(ref.startsWith('NIV') ? 'Lien court copié.' : 'Lien copié (publie d\'abord le niveau pour un lien court).');
          break;
        }
        case 'load': {
          let code = ($('ed-code').value || '').trim();
          try {
            if (/^NIV[0-9A-Z]{3,9}$/i.test(code)) {
              const base = this.apiBase();
              if (!base) throw new Error('code court : serveur indisponible');
              const r = await fetch(base + '/api/levels/' + code.toUpperCase());
              if (!r.ok) throw new Error('niveau introuvable');
              code = (await r.json()).code;
            }
            const def = NS.Loader.decodeLevel(code);
            ed.data.set(NS.Loader.decodeRLE(def.bitmap, def.width * def.height).subarray(0, W * H));
            if (def.width !== W || def.height !== H) throw new Error('taille non gérée par l\'éditeur (' + def.width + 'x' + def.height + '), mais le niveau reste jouable');
            Object.assign(ed, { name: def.name, theme: def.theme, count: def.count, goal: def.goal, time: def.timeLimit });
            ed.hatch = { x: def.hatch.x, y: def.hatch.y, dir: 1 }; ed.exit = { x: def.exit.x, y: def.exit.y };
            this.showEditor(); this.edMsg('Niveau chargé.');
          } catch (e) {
            try { const def = NS.Loader.decodeLevel(code); this.startCustom(def, code); } catch (e2) { this.edMsg('Chargement impossible : ' + e.message); }
          }
          break;
        }
      }
    };

    /** Joue un niveau issu d'un code (test depuis l'éditeur ou niveau reçu). */
    P.startCustom = function (def, code) {
      this.customDef = def;
      this.customCode = code || null;          // pour les rediffusions (référence du niveau)
      this.ai = null;
      this.begin(def, 'custom');
      this.hud.toast(def.name + ' : ' + def.count + ' Bidules, objectif ' + def.goal + '%.', 4000);
    };

    P.showCustomResult = function () {
      const sim = this.sim, p = sim.players[0], won = sim.status === 'won', pct = Math.round((p.saved * 100) / p.count);
      this.openOverlay('<div class="card"><h2>' + (won ? 'Niveau réussi' : 'Niveau raté') + '</h2><div class="result-big ' + (won ? 'win' : 'lose') + '">' + pct + '%</div>' +
        '<p>' + p.saved + ' Bidules sauvés sur ' + p.count + ', objectif ' + p.goal + '%.</p>' +
        '<div class="row"><button class="btn primary" data-action="retry">Rejouer</button><button class="btn" data-action="editor">Retour à l\'éditeur</button><button class="btn" data-action="title">Menu</button></div></div>');
    };
  }

  NS.EditorUI = { install };
})(typeof window !== 'undefined' ? window : globalThis);
