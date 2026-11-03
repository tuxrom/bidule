/**
 * pwa.js
 * Application web progressive : enregistrement du service worker (en http/https seulement : pas en file://),
 * installation (événement beforeinstallprompt, ou consigne pour iOS qui n'en a pas), plein écran, et état
 * hors ligne. Ajoute ses méthodes à la classe Game (voir main.js).
 */
(function (G) {
  'use strict';
  const NS = (G.Bidules = G.Bidules || {});
  let deferred = null;                                   // invite d'installation mémorisée

  const standalone = () => (G.matchMedia && G.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) || G.navigator.standalone === true;
  const ios = () => /iphone|ipad|ipod/i.test(G.navigator.userAgent) && !G.MSStream;

  function register() {
    if (!('serviceWorker' in G.navigator) || !/^https?:$/.test(G.location.protocol)) return;
    G.addEventListener('load', () => {
      G.navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => {
            if (w.state === 'installed' && G.navigator.serviceWorker.controller && G.game) G.game.hud.toast('Nouvelle version prête : recharge la page pour en profiter.', 6000);
          });
        });
      }).catch(() => { /* hors ligne ou refusé : le jeu fonctionne quand même */ });
    });
  }

  G.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (G.game && G.game.refreshPwaButtons) G.game.refreshPwaButtons(); });
  G.addEventListener('appinstalled', () => { deferred = null; if (G.game && G.game.hud) G.game.hud.toast('Application installée.', 3000); });
  const setOffline = () => {
    document.body.classList.toggle('offline', G.navigator.onLine === false);
    if (G.game && G.game.hud) G.game.hud.toast(G.navigator.onLine === false ? 'Hors ligne : campagne, ordinateur et éditeur restent disponibles.' : 'Connexion rétablie.', 3500);
  };
  G.addEventListener('offline', setOffline);
  G.addEventListener('online', setOffline);

  function install(Game) {
    const P = Game.prototype;

    /** Boutons « Installer » et « Plein écran » du menu principal, selon ce que l'appareil permet. */
    P.pwaButtons = function () {
      const canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
      const canInstall = !standalone() && (deferred || ios());
      return '<div class="row small">' +
        (canFull && !standalone() ? '<button class="btn" data-action="fullscreen">Plein écran</button>' : '') +
        (canInstall ? '<button class="btn" data-action="install">Installer l\'application</button>' : '') + '</div>' +
        (G.navigator.onLine === false ? '<div class="netstate">Hors ligne : le jeu en ligne est indisponible.</div>' : '');
    };

    P.refreshPwaButtons = function () { if (!this.sim && !$('overlay').hidden && document.getElementById('logo')) this.showTitle(); };

    P.installApp = async function () {
      if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* ignoré */ } deferred = null; this.refreshPwaButtons(); }
      else if (ios()) this.hud.toast('Sur iPhone et iPad : bouton Partager, puis « Sur l\'écran d\'accueil ».', 7000);
      else this.hud.toast('Utilise le menu du navigateur : « Installer l\'application ».', 5000);
    };

    P.toggleFullscreen = function () {
      const d = document, el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else if (el.requestFullscreen || el.webkitRequestFullscreen) {
        const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => {});
        // Verrou d'orientation facultatif : sans effet (et sans erreur) là où il n'existe pas.
        if (G.screen && G.screen.orientation && G.screen.orientation.lock) G.screen.orientation.lock('landscape').catch(() => {});
      } else this.hud.toast('Plein écran indisponible ici : installe l\'application.', 4000);
    };
  }
  const $ = (id) => document.getElementById(id);

  register();
  NS.PWA = { install, standalone };
})(typeof window !== 'undefined' ? window : globalThis);
