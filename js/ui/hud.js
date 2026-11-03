/**
 * hud.js
 * Interface en HTML/CSS par-dessus le canvas : compteurs, barre de
 * compétences, boutons. Le DOM n'est modifié que lorsqu'une valeur change,
 * pour ne pas coûter de temps de mise en page à chaque image.
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
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };

  const $ = (id) => document.getElementById(id);

  class HUD {
    constructor() {
      this.cache = {};
      this.skillButtons = {};
      this.buildSkillbar();
      $('btn-undo').innerHTML = ICONS.undo;
      $('btn-menu').innerHTML = ICONS.menu;
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
        const icon = NS.Sprites.icon(s.id);
        b.appendChild(icon);
        b.insertAdjacentHTML('beforeend',
          '<span class="lbl">' + s.label + '</span><span class="cnt">0</span><span class="key">' + (i + 1) + '</span>');
        bar.appendChild(b);
        this.skillButtons[s.id] = { el: b, cnt: b.querySelector('.cnt') };
      });
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

    /** Rafraîchit compteurs et boutons depuis l'état de la simulation. */
    update(sim, selected, canUndo) {
      const pct = sim.count ? Math.floor((sim.saved * 100) / sim.count) : 0;
      this.set('st-alive', String(sim.bidules.length));
      this.set('st-out', sim.released + '/' + sim.count);
      this.set('st-saved', pct + '% / ' + sim.def.goal + '%');
      $('st-saved').classList.toggle('ok', sim.saved >= sim.needed);
      const left = sim.timeLeft();
      this.set('st-time', Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
      $('st-time').classList.toggle('low', left <= 30);
      this.set('st-rate', String(sim.rate));
      for (const s of NS.Skills.list) {
        const e = this.skillButtons[s.id];
        const n = sim.skills[s.id] | 0;
        if (e.cnt.textContent !== String(n)) e.cnt.textContent = n;
        e.el.disabled = n <= 0;
        e.el.classList.toggle('on', s.id === selected);
      }
      $('btn-undo').disabled = !canUndo;
      $('btn-rate-dec').disabled = sim.rate <= sim.rateMin;
      $('btn-rate-inc').disabled = sim.rate >= NS.C.RATE_MAX;
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
