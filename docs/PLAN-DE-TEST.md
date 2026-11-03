# Plan de test du multijoueur, avec simulation de latence

## 1. Tests automatiques

`npm test` (environ 3 minutes) enchaîne tout ; `npm run test:net` ne lance que le réseau (environ 90 s).

| Fichier | Ce qui est vérifié |
|---|---|
| `tests/net.test.js` | Vrai serveur `ws`, vrais clients headless, latence et gigue simulées (voir 2.1). 10 scénarios ci-dessous. |
| `tests/editor.test.js` | Codes de niveaux : aller-retour exact, valeurs bornées, codes hostiles refusés ; API de publication ; fichiers privés introuvables. |
| `tests/pwa.test.js` | Précache à jour, manifeste et icônes ; dans Chromium : service worker installé, **rechargement hors ligne**, campagne, ordinateur, éditeur jouables. |
| `tests/weapons.test.js` | Dont le brouilleur radar (10 s sans arme, sans pilotage, sans détonation). |
| `tests/ai.test.js` | Équité et hiérarchie de l'IA (inchangé). |
| `tests/browser-smoke.js` | Menus et parcours complet dans un navigateur (Playwright requis). |

### Scénarios de `tests/net.test.js`

| # | Scénario | Critère de réussite |
|---|---|---|
| 1 | Protocole | Version incompatible, JSON invalide, message avant `hello`, salon inconnu : tous refusés avec le bon code. |
| 2 | Salon | Code à 4 lettres ; seul l'hôte règle la partie ; l'état « prêt » de chacun est visible de l'autre ; un troisième joueur reçoit `room-full`. |
| 3 | Lockstep sans latence | Les sommes de contrôle du client A, du client B **et du serveur** sont égales sur au moins 10 points de comparaison ; des dizaines de commandes échangées ; en duel, `player == by`. |
| 4 | Latence | Trois séries (15, 45 et 120 ms de latence de jeu par sens, avec gigue) : aucune désynchronisation, au moins 8 comparaisons concordantes par série, et le délai d'entrée **augmente avec la latence** (mesuré : 4, 5 puis 7 pas). |
| 5 | Désynchronisation | Un pixel de terrain est corrompu chez B : `desync` détecté à la somme de contrôle suivante, `resync` par rejeu du journal, B de nouveau aligné ensuite, A non concerné. |
| 6 | Reconnexion | Le socket de B est coupé en pleine partie : A est prévenu, l'horloge est suspendue, B se reconnecte seul avec son jeton, se reconstruit, la partie reprend, les sommes de contrôle concordent ensuite. |
| 7 | Abandon | `resign` : défaite immédiate de l'abandonnant ; déconnexion sans retour : forfait après le délai de grâce, victoire de l'autre. |
| 8 | Partie complète | Jusqu'à la fin : `end` reçu, état final (somme de contrôle, pas) **identique** chez les deux clients et le serveur. |
| 9 | Coop | Une commande hors rôle est rejetée ; l'armée est commune (`player` 0), `by` identifie l'émetteur ; quand le partenaire part, l'autre reçoit tous les rôles. |
| 10 | Sécurité et chat | Emojis : codes fixes, limités en débit ; commandes aux valeurs absurdes, au type inconnu ou usurpant un autre camp : rejetées ou normalisées ; propriétaire et date imposés par le serveur. |

### 2.1 Comment la latence est simulée dans les tests

Le client réseau (`js/net/netclient.js`) accepte n'importe quelle classe de WebSocket. Le test lui donne un enrobage (`lagWS`) qui
retarde chaque message, entrant et sortant, de `latence + aléa x gigue` en **conservant l'ordre** comme le ferait TCP. Pour finir
des parties en quelques secondes, le serveur et les clients tournent en temps accéléré (`NET_TIME_SCALE`) ; le serveur
multiplie alors les RTT mesurés par le même facteur pour calculer le délai d'entrée, si bien qu'une latence réelle de 15 ms
équivaut à 45 ms de jeu avec un facteur 3.

## 2. Tests manuels avec latence

Quatre outils, du plus simple au plus réaliste. Dans tous les cas, jouer un duel complet à deux navigateurs et observer l'indicateur en
bas à gauche (RTT et délai d'entrée) et le bandeau d'état.

1. **Paramètre d'adresse** : `http://localhost:3000/?lag=120` retarde chaque message de 120 ms (plus 40 ms de gigue) dans cette
   page. Ouvrir une page avec `?lag=0` et une autre avec `?lag=250` pour un duel asymétrique.
2. **Proxy de latence** (navigateurs ou appareils réels, sans toucher au code) :
   ```bash
   npm start &                                                    # serveur sur 3000
   node tools/lag-proxy.js --listen 3200 --target 3000 --latency 150 --jitter 60
   # jouer via http://localhost:3200 ; ajouter --cut 20 pour couper toutes les connexions toutes les 20 s
   ```
3. **Limitation du navigateur** : Chrome, outils de développement, onglet Réseau, profil « Slow 3G » ou personnalisé (latence 300 ms).
4. **Linux** : `sudo tc qdisc add dev lo root netem delay 100ms 30ms loss 2%` (puis `... del dev lo root`). Une perte de
   paquets TCP se traduit par des rafales de retard, ce que le lockstep absorbe par son rattrapage.

### Matrice d'essais

| Conditions | Attendu |
|---|---|
| RTT 0 à 30 ms | Délai d'entrée 100 ms. Aucun bandeau. Ordres quasi instantanés. |
| RTT 100 à 200 ms | Délai 130 à 200 ms. Commandes exécutées au pas annoncé chez les deux joueurs ; aucune désynchronisation. |
| RTT 300 à 500 ms | Délai monte vers 300 à 500 ms. Jeu jouable, ordres plus lents. |
| Gigue forte (RTT 50 à 400 ms en alternance) | Le client accélère pour rattraper (jusqu'à x4) ; bandeau « Retard réseau : rattrapage… » éventuel ; pas de désynchronisation. |
| Coupure franche (`--cut`, mode avion 5 s) | Bandeau « Connexion perdue, reconnexion… » chez le joueur coupé ; l'autre voit « Adversaire déconnecté, N s avant abandon » ; reprise automatique, « Resynchronisation… » puis partie normale. |
| Coupure de plus de 30 s | Forfait : l'autre joueur gagne par abandon (coop : il continue seul avec tous les rôles). |
| Onglet en arrière-plan 20 s | Au retour, rattrapage rapide (le serveur n'a pas attendu) ; les ordres donnés entre-temps n'existent pas. |
| Redémarrage du serveur | Message « Le serveur a redémarré : la partie ou le salon est perdu. » et retour au menu en ligne. |

### Provoquer une désynchronisation à la main

Dans la console d'un des deux navigateurs, pendant une partie : `game.net.debugCorrupt()`. Dans les 2 s qui suivent, un message
« Désynchronisation détectée : resynchronisation… » apparaît, l'écran se reconstruit et le jeu reprend. Le serveur journalise
`désynchronisation du joueur N au pas T`.

## 3. Tests manuels PWA

| Vérification | Comment | Attendu |
|---|---|---|
| Installation | Chrome (ordinateur ou Android) sur une adresse `https://` ou `localhost` : bouton « Installer l'application » du menu, ou icône d'installation de la barre d'adresse | L'application s'ouvre dans sa fenêtre, sans barre d'adresse, avec l'icône du Bidule. |
| iPhone / iPad | Safari, Partager, « Sur l'écran d'accueil » | Plein écran, icône `apple-touch-icon`. Le bouton « Installer » affiche la consigne. |
| Plein écran | Bouton « Plein écran » du menu (non installé) | Le navigateur passe en plein écran ; sur Android installé, plein écran natif (`display_override`). |
| Hors ligne | Outils de développement, Application, Service Workers, cocher « Offline », recharger | Le menu s'affiche ; campagne, contre l'ordinateur et éditeur jouent ; « En ligne » annonce l'indisponibilité. |
| Mise à jour | Modifier un fichier, `npm start` (régénère la version), recharger deux fois | Message « Nouvelle version prête » puis nouvelle version. |
| Audit | Lighthouse, catégorie PWA | Installable, service worker, manifeste, icônes maskable, thème. |

## 4. Critères d'acceptation

* Aucune désynchronisation durable, quelle que soit la latence testée jusqu'à RTT 500 ms.
* Toute désynchronisation provoquée est corrigée en moins de 5 secondes de jeu.
* Une reconnexion dans les 30 secondes rend la partie sans perte d'état.
* Aucune commande invalide ne modifie l'état de la partie.
* Hors ligne, tout sauf le jeu en ligne et la publication de niveaux reste utilisable.
