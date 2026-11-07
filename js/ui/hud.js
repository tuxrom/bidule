/**
 * hud.js
 * Interface en HTML/CSS par-dessus le canvas : compteurs, barre de
 * compétences, arsenal, panneau du canon, boutons. Le DOM n'est modifié que
 * lorsqu'une valeur change, pour ne pas coûter de mise en page à chaque image.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  const ICONS = {
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 7H5V3M5 7c3-4 10-4 13 1s0 10-6 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16 8c2 2 2 6 0 8M19 5c4 4 4 10 0 14"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    rewind: '<svg viewBox="0 0 24 24"><path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/></svg>',
    kill: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="6"/><path d="M9 20h6M10 16v4M14 16v4M10 9h.01M14 9h.01"/></svg>'
  };

  const $ = (id) => document.getElementById(id);

  class HUD {
    constructor() {
      this.cache = {};
      this.skillButtons = {};
      this.armButtons = {};
      this.buildSkillbar();
      $('btn-undo').innerHTML = ICONS.undo;
      $('btn-menu').innerHTML = ICONS.menu;
      $('btn-kill').innerHTML = ICONS.kill;
      $('btn-rewind').innerHTML = ICONS.rewind;
      this.setMuted(false);
      this.setPaused(false);
    }

    /** Une touche par compétence enregistrée (ordre du registre). */
    buildSkillbar() {
      const bar = $('skillbar');
      bar.innerHTML = '';
      NS.Skills.list.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'btn skill';
        b.dataset.skill = s.id;
        b.setAttribute('aria-label', s.label);
        b.appendChild(NS.Sprites.icon(s.id));
        b.insertAdjacentHTML('beforeend',
          '<span class="lbl">' + s.label + '</span><span class="cnt">0</span><span class="key">' + (i + 1) + '</span>');
        bar.appendChild(b);
        this.skillButtons[s.id] = { el: b, cnt: b.querySelector('.cnt') };
      });
    }

    /** Arsenal du niveau : seules les armes débloquées ont un bouton. */
    buildArmbar(sim, me) {
      const bar = $('armbar');
      bar.innerHTML = '';
      this.armButtons = {};
      const p = sim.players[me | 0];
      NS.Weapons.list.filter((w) => p.weapons[w.id]).forEach((w, i) => {
        const b = document.createElement('button');
        b.className = 'btn arm';
        b.dataset.weapon = w.id;
        b.title = w.label + ' : ' + w.cost + ' pts, recharge ' + Math.round(w.cooldown / NS.C.TICK_RATE) + ' s';
        b.setAttribute('aria-label', w.label);
        b.appendChild(NS.Sprites.weaponIcon(w.id));
        b.insertAdjacentHTML('beforeend',
          '<span class="lbl">' + w.label + '</span><span class="cnt">0</span><span class="cost">' + w.cost + '</span><span class="key">' + ((i + 1) % 10) + '</span><i class="cd"></i>');
        bar.appendChild(b);
        this.armButtons[w.id] = { el: b, cnt: b.querySelector('.cnt'), cd: b.querySelector('.cd') };
      });
      bar.style.setProperty('--n', Math.max(1, Object.keys(this.armButtons).length));
      $('btn-tab').hidden = Object.keys(this.armButtons).length === 0;
    }

    set(id, html) {
      if (this.cache[id] === html) return;
      this.cache[id] = html;
      $(id).innerHTML = html;
    }

    setPaused(p) {
      this.set('btn-pause', p ? ICONS.play : ICONS.pause);
      $('pause-badge').classList.toggle('show', p);
      $('btn-pause').classList.toggle('on', p);
    }
    setMuted(m) {
      $('btn-mute').innerHTML = m ? ICONS.mute : ICONS.sound;
      $('btn-mute').setAttribute('aria-pressed', String(m));
    }
    setSpeed(s) {
      $('btn-x2').classList.toggle('on', s === 2);
      $('btn-x4').classList.toggle('on', s === 4);
    }

    /** Bascule entre compétences et arsenal. */
    setTab(tab) {
      $('skillbar').hidden = tab !== 'skills';
      $('armbar').hidden = tab !== 'arms';
      $('btn-tab').textContent = tab === 'skills' ? 'Arsenal' : 'Compétences';
      $('btn-tab').classList.toggle('on', tab === 'arms');
    }

    /** Panneau de réglage du canon (angle, puissance). */
    showAim(on, angle, power) {
      $('aimpanel').hidden = !on;
      if (on) {
        $('aim-angle').value = angle; $('aim-power').value = power;
        $('aim-angle-v').textContent = Math.round(angle) + '°'; $('aim-power-v').textContent = Math.round(power);
      }
    }

    /** Rafraîchit compteurs et boutons depuis l'état de la simulation. */
    update(sim, ui) {
      const mi = ui.me | 0, me = sim.players[mi], vs = sim.mode === 'vs';
      this.set('st-alive', String(sim.bidules.filter((b) => b.owner === mi).length));
      this.set('st-out', me.released + '/' + me.count);
      if (vs) {
        const o = sim.players[1 - mi];
        this.set('st-saved', me.saved + ' : ' + o.saved);
        $('st-saved').classList.toggle('ok', me.saved > o.saved);
      } else {
        const pct = me.count ? Math.floor((me.saved * 100) / me.count) : 0;
        this.set('st-saved', pct + '% / ' + me.goal + '%');
        $('st-saved').classList.toggle('ok', me.saved >= me.needed);
      }
      $('lbl-saved').textContent = vs ? 'Score' : 'Sauvés';
      const left = sim.timeLeft();
      this.set('st-time', Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
      $('st-time').classList.toggle('low', left <= 30);
      this.set('st-rate', String(me.rate));
      this.set('st-points', String(Math.floor(me.points)));
      for (const s of NS.Skills.list) {
        const e = this.skillButtons[s.id];
        const n = me.skills[s.id] | 0;
        if (e.cnt.textContent !== String(n)) e.cnt.textContent = n;
        const barred = !!(ui.mask && !ui.mask.skills.has(s.id));        // compétence confiée au partenaire (coop)
        e.el.disabled = n <= 0 || barred;
        e.el.classList.toggle('partner', barred);
        e.el.classList.toggle('on', ui.tab === 'skills' && !ui.kill && s.id === ui.skill);
      }
      for (const w of NS.Weapons.list) {
        const e = this.armButtons[w.id];
        if (!e) continue;
        const slot = me.weapons[w.id];
        if (e.cnt.textContent !== String(slot.stock)) e.cnt.textContent = slot.stock;
        const frac = slot.cd > 0 ? Math.min(1, slot.cd / w.cooldown) : 0;
        e.cd.style.height = (frac * 100).toFixed(0) + '%';
        const barred = !!(ui.mask && !ui.mask.weapons.has(w.id));
        const jam = me.jammedUntil > sim.tick;
        e.el.disabled = slot.stock <= 0 || barred || jam;
        e.el.classList.toggle('partner', barred);
        e.el.classList.toggle('poor', me.points < w.cost && slot.stock > 0);
        e.el.classList.toggle('cooling', slot.cd > 0);
        e.el.classList.toggle('on', ui.tab === 'arms' && w.id === ui.weapon);
      }
      $('btn-undo').disabled = !ui.canUndo;
      $('btn-undo').hidden = !ui.undoable;
      $('btn-rewind').disabled = !ui.canRewind;
      $('btn-kill').hidden = !!ui.watching;
      $('btn-rate-dec').parentElement.classList.toggle('locked', !!ui.watching);
      $('btn-kill').classList.toggle('on', !!ui.kill);
      $('btn-kill').setAttribute('aria-pressed', String(!!ui.kill));
      $('btn-rate-dec').disabled = me.rate <= me.rateMin;
      $('btn-rate-inc').disabled = me.rate >= NS.C.RATE_MAX;
      $('btn-boom').hidden = !ui.canBoom;
      const jamLeft = Math.max(0, Math.ceil((me.jammedUntil - sim.tick) / NS.C.TICK_RATE));
      $('jam-badge').hidden = jamLeft <= 0;
      if (jamLeft > 0) $('jam-badge').textContent = 'Brouillé ' + jamLeft + ' s';
      const rev = Math.max(0, Math.ceil((me.revealUntil - sim.tick) / NS.C.TICK_RATE));
      $('reveal-badge').hidden = rev <= 0;
      if (rev > 0) $('reveal-badge').textContent = 'Reconnaissance ' + rev + ' s';
    }

    setLevelName(name) { $('st-name').textContent = name; }

    toast(text, ms) {
      const t = $('toast');
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
    }
  }

  NS.HUD = HUD;
})(typeof window !== 'undefined' ? window : globalThis);
