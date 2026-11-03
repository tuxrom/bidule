/**
 * audio.js
 * Sons et musique synthétisés avec l'API Web Audio : aucun fichier audio.
 *  - effets : oscillateurs et bruit filtré, courtes enveloppes ;
 *  - musique : petite boucle générative en gamme "phrygienne dominante"
 *    (ambiance désert), planifiée à l'avance sur l'horloge audio ;
 *  - bouton muet persistant (localStorage).
 * Le contexte audio ne démarre qu'après un geste de l'utilisateur (règle des
 * navigateurs, notamment iOS) : unlock() est appelé au premier appui.
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});

  /** Une couleur musicale par univers : tonique (note MIDI), gamme (demi-tons), tempo, timbre du chant. */
  const MUSIC = {
    desert: { root: 38, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 92, lead: 'square' },     // ré phrygien dominant
    ruins: { root: 33, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 78, lead: 'sawtooth' },    // la mineur naturel, plus lent
    arctic: { root: 43, scale: [0, 2, 4, 6, 7, 9, 11], bpm: 70, lead: 'triangle' },   // sol lydien, aérien
    orbital: { root: 36, scale: [0, 2, 4, 6, 8, 10, 11], bpm: 112, lead: 'square' }   // gamme par tons, arpèges vifs
  };
  let SCALE = MUSIC.desert.scale, ROOT = MUSIC.desert.root;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.musicOn = false;
      this.last = {};                // anti-rafale : dernier instant par type de son
      this.noiseBuf = null;
      try { this.muted = localStorage.getItem('bidules.muted') === '1'; } catch (e) { /* stockage indisponible */ }
    }

    /** À appeler depuis un geste utilisateur. */
    unlock() {
      if (!this.ctx) {
        const AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        const comp = this.ctx.createDynamicsCompressor();
        this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.7;
        this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.35;
        this.sfxBus.connect(comp); this.musicBus.connect(comp);
        comp.connect(this.master); this.master.connect(this.ctx.destination);
        // Tampon de bruit blanc partagé.
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem('bidules.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
    }

    /* ------------------------------ Briques de base ------------------------------ */

    tone(type, f0, f1, dur, vol, delay) {
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + dur + 0.02);
    }

    noise(dur, vol, filterType, f0, f1, delay, bus) {
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = filterType;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    }

    /* --------------------------------- Effets ---------------------------------- */

    /** Joue l'effet `name` ; `gap` (s) limite la cadence pour éviter la cacophonie. */
    sfx(name, gap) {
      if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      if (gap && this.last[name] && now - this.last[name] < gap) return;
      this.last[name] = now;
      switch (name) {
        case 'select': this.tone('square', 660, 660, 0.05, 0.12); break;
        case 'assign': this.tone('square', 520, 520, 0.06, 0.14); this.tone('square', 780, 780, 0.09, 0.14, 0.06); break;
        case 'deny': this.tone('sawtooth', 150, 110, 0.14, 0.15); break;
        case 'hatch': this.noise(0.18, 0.4, 'bandpass', 900, 200, 0, null); this.tone('sine', 110, 70, 0.25, 0.35); break;
        case 'spawn': this.tone('triangle', 330, 440, 0.05, 0.08); break;
        case 'dig': this.noise(0.05, 0.22, 'bandpass', 900, 500); break;
        case 'bash': this.noise(0.07, 0.3, 'bandpass', 500, 250); break;
        case 'mine': this.noise(0.09, 0.3, 'bandpass', 700, 300); break;
        case 'brick': this.tone('triangle', 300, 260, 0.06, 0.18); break;
        case 'warn': this.tone('square', 1200, 1200, 0.07, 0.12); break;
        case 'clink': this.tone('sine', 2100, 2100, 0.1, 0.12); this.tone('sine', 3150, 3150, 0.08, 0.08); break;
        case 'ohno': this.tone('square', 900, 280, 0.3, 0.14); break;
        case 'explode':
          this.noise(0.6, 0.9, 'lowpass', 1800, 80);
          this.tone('sine', 120, 38, 0.5, 0.7);
          break;
        case 'splat': this.noise(0.12, 0.45, 'lowpass', 1200, 200); this.tone('sine', 200, 60, 0.15, 0.3); break;
        case 'drown': this.tone('sine', 300, 900, 0.22, 0.2); this.noise(0.2, 0.25, 'lowpass', 900, 300); break;
        case 'burn': this.noise(0.3, 0.35, 'highpass', 4000, 1500); break;
        case 'chute': this.noise(0.15, 0.25, 'bandpass', 1500, 500); break;
        case 'saved':
          this.tone('square', 660, 660, 0.07, 0.1);
          this.tone('square', 880, 880, 0.07, 0.1, 0.06);
          this.tone('square', 1320, 1320, 0.1, 0.1, 0.12);
          break;
        case 'recon': this.tone('sine', 400, 1600, 0.35, 0.18); this.tone('sine', 1600, 400, 0.35, 0.12, 0.35); break;
        case 'drone': this.tone('sawtooth', 220, 330, 0.25, 0.08); this.tone('sawtooth', 224, 334, 0.25, 0.08); break;
        case 'lock': [900, 900, 900].forEach((f, i) => this.tone('square', f, f, 0.06, 0.1, i * 0.18)); break;
        case 'beam': this.noise(0.5, 0.8, 'highpass', 400, 6000); this.tone('sawtooth', 1800, 60, 0.5, 0.35); break;
        case 'cannon': this.noise(0.25, 0.8, 'lowpass', 900, 120); this.tone('sine', 90, 40, 0.3, 0.7); break;
        case 'shield': this.tone('sine', 300, 900, 0.3, 0.15); this.tone('sine', 450, 1350, 0.3, 0.08); break;
        case 'jet': this.noise(0.12, 0.2, 'bandpass', 2500, 1500); break;
        case 'grapple': this.tone('square', 1500, 500, 0.12, 0.1); this.tone('triangle', 200, 260, 0.2, 0.15, 0.1); break;
        case 'jam': this.noise(0.6, 0.5, 'bandpass', 3000, 800); this.tone('square', 1200, 150, 0.5, 0.12); break;
        case 'tank': this.tone('sawtooth', 70, 50, 0.4, 0.3); this.noise(0.3, 0.3, 'lowpass', 400, 100); break;
        case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.16, 0.16, i * 0.14)); break;
        case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone('sawtooth', f, f * 0.98, 0.25, 0.14, i * 0.2)); break;
      }
    }

    /** Traduit les événements de la simulation en sons. */
    handle(ev) {
      switch (ev.type) {
        case 'assign': this.sfx('assign'); break;
        case 'hatch': this.sfx('hatch'); break;
        case 'spawn': this.sfx('spawn', 0.12); break;
        case 'dig': this.sfx('dig', 0.15); break;
        case 'bash': this.sfx('bash', 0.18); break;
        case 'mine': this.sfx('mine', 0.2); break;
        case 'brick': this.sfx('brick', 0.05); break;
        case 'warn': this.sfx('warn', 0.2); break;
        case 'clink': this.sfx('clink', 0.15); break;
        case 'ohno': this.sfx('ohno'); break;
        case 'explode': this.sfx('explode'); break;
        case 'chute': this.sfx('chute', 0.1); break;
        case 'recon': this.sfx('recon'); break;
        case 'lock': this.sfx('lock'); break;
        case 'jam': this.sfx('jam'); break;
        case 'beam': this.sfx('beam'); break;
        case 'cannon': this.sfx('cannon'); break;
        case 'jet': this.sfx('jet', 0.2); break;
        case 'jetpuff': this.sfx('jet', 0.25); break;
        case 'grapple': this.sfx('grapple'); break;
        case 'trapoff': this.sfx('clink', 0.15); break;
        case 'weapon':
          if (ev.extra === 'kdrone') this.sfx('drone');
          else if (ev.extra === 'shield') this.sfx('shield');
          else if (ev.extra === 'tank') this.sfx('tank');
          else if (ev.extra === 'zipline' || ev.extra === 'mine') this.sfx('brick');
          break;
        case 'saved': this.sfx('saved', 0.08); break;
        case 'die':
          if (ev.extra === 'splat') this.sfx('splat', 0.08);
          else if (ev.extra === 'drown') this.sfx('drown', 0.08);
          else if (ev.extra === 'burn') this.sfx('burn', 0.08);
          break;
      }
    }

    /* --------------------------------- Musique --------------------------------- */

    /** Lance (ou relance dans la couleur d'un autre univers) la musique générative. */
    startMusic(theme) {
      const m = MUSIC[theme] || MUSIC.desert;
      SCALE = m.scale; ROOT = m.root;
      this.bpm = m.bpm; this.leadType = m.lead; this.theme = theme;
      if (!this.ctx || this.musicOn) return;
      this.musicOn = true;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.seed = 12345;
      this.timer = setInterval(() => this.schedule(), 40);
    }

    stopMusic() {
      this.musicOn = false;
      clearInterval(this.timer);
    }

    /** Petit générateur congruentiel : la mélodie est la même à chaque lancement. */
    rnd() { this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0; return this.seed / 4294967296; }

    schedule() {
      const c = this.ctx;
      if (!c || c.state !== 'running') return;
      const spb = 60 / (this.bpm || 92) / 2;          // croche au tempo de l'univers
      while (this.nextTime < c.currentTime + 0.25) {
        this.note(this.step, this.nextTime);
        this.nextTime += spb;
        this.step = (this.step + 1) % 64;
      }
    }

    voice(type, f, t, dur, vol, cutoff) {
      const c = this.ctx;
      const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
      o.type = type; o.frequency.value = f;
      fl.type = 'lowpass'; fl.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.05);
    }

    note(step, t) {
      const bar = (step >> 4) & 3, s16 = step & 15;
      // Basse : tonique à chaque temps fort, quinte en contre-temps ; la 3e mesure monte d'un degré.
      const bassDeg = [0, 0, 3, 4][bar];
      if (s16 % 4 === 0) this.voice('triangle', mtof(ROOT + SCALE[bassDeg]), t, 0.45, 0.5, 600);
      else if (s16 % 4 === 2) this.voice('triangle', mtof(ROOT + 7), t, 0.2, 0.25, 500);
      // Percussion légère.
      if (s16 % 4 === 0) this.noise(0.08, 0.12, 'lowpass', 300, 60, t - this.ctx.currentTime, this.musicBus);
      if (s16 % 4 === 2) this.noise(0.03, 0.05, 'highpass', 6000, 6000, t - this.ctx.currentTime, this.musicBus);
      // Mélodie arpégée.
      if (this.rnd() < 0.62) {
        const deg = (bar % 2 ? [0, 2, 4, 5, 6] : [0, 1, 4, 6, 3])[(this.rnd() * 5) | 0];
        const oct = this.rnd() < 0.3 ? 24 : 12;
        this.voice(this.leadType || 'square', mtof(ROOT + oct + SCALE[deg]), t, 0.22, 0.09, 1800);
      }
    }
  }

  NS.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
