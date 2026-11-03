# Opération Mirage : les Bidules

Jeu de réflexion 2D en HTML5 Canvas, jouable au clavier et à la souris sur PC, au doigt sur mobile.
Une troupe de petits soldats-robots, les **Bidules**, sort d'une trappe et marche tout droit. Ils ne
s'arrêtent jamais : le joueur leur distribue des compétences, puis un arsenal moderne, pour franchir les
pièges de quatre mondes, ou pour saboter l'armée adverse sur une carte symétrique.

Nom, personnages, graphismes, sons et niveaux sont originaux. Aucun fichier image ou audio : tout est généré par le code.

## Ouvrir le jeu en local

Aucun serveur, aucune installation, aucune dépendance.

1. Télécharger ou cloner le dépôt.
2. Ouvrir `index.html` dans un navigateur récent (Chrome, Edge, Firefox, Safari).

Les scripts sont des scripts classiques et non des modules ES, ce qui permet l'ouverture directe en `file://`.
Pour tester sur un téléphone : `python3 -m http.server 8000`, puis `http://<ip-du-poste>:8000`.

Le son démarre au premier appui (règle des navigateurs). Pour essayer n'importe quel niveau sans progression,
ouvrir `index.html?debloquer`.

## Modes de jeu

### Campagne : 40 niveaux, 4 univers

| Univers | Niveaux | Ambiance |
|---|---|---|
| Désert des mirages | 1 à 10 | dunes, cactus, montagnes mauves |
| Ville en ruines | 11 à 20 | béton, ciel poussiéreux, silhouettes d'immeubles, brouillard |
| Base arctique | 21 à 30 | neige et glace, aurore, sapins |
| Station orbitale | 31 à 40 | plaques métalliques, vide étoilé, planète |

* Les trois premiers niveaux sont écrits à la main, les 37 autres sont générés par segments (voir l'architecture) ;
  leur solvabilité est vérifiée par script.
* **Difficulté croissante** : plus d'obstacles, plus de Bidules, objectif plus haut, pièges cachés dès le niveau 7,
  brouillard dès le niveau 11, marges de stock réduites.
* **Déblocage** : un niveau s'ouvre quand le précédent est terminé. Les armes arrivent au fil des niveaux
  (tableau d'équilibrage plus bas).
* **Trois étoiles par niveau** : 1 pour l'objectif atteint, 2 à objectif + 20 points de pourcentage, 3 à objectif + 35
  points en moins de 75 % du temps. Meilleur score, étoiles et déblocages sont sauvegardés dans `localStorage`.

### Contre l'ordinateur

Deux armées, deux trappes aux extrémités d'une carte symétrique (moitié gauche tirée au sort, moitié droite en miroir
parfait), mêmes stocks de compétences, mêmes armes, mêmes points. Le vainqueur est celui qui sauve le plus de Bidules.
Choix du niveau : **Facile**, **Moyen**, **Difficile**. L'IA envoie des commandes comme le joueur. Voir l'architecture de l'IA.

Règles propres au duel : brouillard de guerre (on ne voit l'adversaire que près de ses Bidules ou sous drone de
reconnaissance), pièges cachés symétriques, briques des deux camps traversables par l'autre, annulation désactivée.

## Commandes

| Action | PC | Mobile |
|---|---|---|
| Choisir une compétence / une arme | boutons du bas, chiffres `1` à `8` (arsenal : `1` à `0`) | boutons du bas |
| Basculer compétences / arsenal | `Tab` | bouton « Arsenal » |
| Appliquer / viser / poser | clic gauche | appui |
| Canon : viser | toucher la carte, ou curseurs angle et puissance ; `Entrée` ou « Tirer » | idem |
| Drone kamikaze | déplacer le curseur pour piloter ; clic ou `B` pour exploser | glisser le doigt ; « Détoner » |
| Détoner mines et drone | `B` | bouton « Détoner » |
| Zoom | molette, `+` / `-` | pincement à deux doigts |
| Défiler | glisser, flèches, `Maj` + molette | glissement à deux doigts |
| Pause (les ordres restent possibles) | `P` ou `Espace` | bouton pause |
| Vitesse x2 / x4 | boutons, `F` | boutons x2, x4 |
| Annuler la dernière action (campagne) | `U` ou `Ctrl+Z` | bouton annuler |
| Cadence de la trappe | `PgUp` / `PgDn` | boutons + et - |
| Son, recommencer, menu | `M`, `R`, `Échap` | boutons |

Les chiffres utilisent `event.code` : sur AZERTY, la touche `&` choisit la première compétence sans `Maj`.

## Compétences (8)

Bloqueur, bâtisseur d'escalier, creuseur vertical, mineur diagonal, foreur horizontal, parachutiste, kamikaze, et
**grimpeur** (permanent : escalade les murs jusqu'au rebord, débloqué au niveau 4).

Pendant qu'un bâtisseur, un foreur ou un mineur travaille, les Bidules qui le suivent **attendent derrière lui** et
le suivent à distance : ils ne tombent pas au bout d'un escalier inachevé.

## Arsenal (10 armes)

Chaque arme a un **stock limité par niveau**, un **coût en points** (réserve de départ 100, régénération 1 par seconde
en campagne, 0,5 en duel) et un **temps de recharge**. Une explosion tue au plus 3 Bidules et épargne ceux d'un bouclier.

| Arme | Effet |
|---|---|
| Drone de reconnaissance | lève le brouillard et révèle les pièges pendant 20 s |
| Drone kamikaze | piloté par le joueur vers une cible, explose au contact du terrain ou d'un Bidule adverse |
| Frappe satellite | après 1,5 s de visée, perce une colonne de 7 px sur toute la hauteur, roche comprise |
| Canon César | tir en cloche, angle 5 à 85 degrés, puissance 0 à 100, cratère de rayon 30 |
| Bouclier énergétique | dôme de rayon 30 pendant 15 s : explosions et pièges sans effet |
| Tyrolienne | câble tendu de A vers un point B plus bas, 25 s : tous les Bidules qui passent en A glissent |
| Jetpack | un Bidule monte de 88 px puis plane ; parachute de secours à l'arrêt du moteur |
| Grappin | tire un Bidule vers un point d'ancrage à 110 px au plus, par un trajet libre |
| Mine télécommandée | posée au sol, explose à l'ordre (rayon 26), tue amis et ennemis |
| Char d'assaut | embarque 8 Bidules, laboure le sable, roule sur l'eau et la lave, écrase l'adversaire, sauve ses passagers à la sortie |

## Équilibrage proposé

### Armes

Durées en secondes (30 pas par seconde). « Niveau » : rang de campagne où l'arme apparaît.

| Arme | Coût (pts) | Recharge | Stock / niveau | Rayon ou portée | Durée | Niveau |
|---|---|---|---|---|---|---|
| Drone de reconnaissance | 15 | 40 s | 3 | carte entière | 20 s | 5 |
| Drone kamikaze | 25 | 25 s | 3 | explosion 22 | 20 s de vol | 11 |
| Frappe satellite | 60 | 90 s | 2 | colonne de 7 px, 3 victimes | visée 1,5 s | 31 |
| Canon César | 35 | 20 s | 4 | cratère 30, 3 victimes | vol ≤ 4 s | 13 |
| Bouclier énergétique | 20 | 25 s | 3 | dôme 30 | 15 s | 15 |
| Tyrolienne | 15 | 15 s | 3 | câble ≤ 220 px | 25 s | 21 |
| Jetpack | 10 | 5 s | 5 | 88 px de montée, ~110 px de plané | 3,7 s | 18 |
| Grappin | 10 | 5 s | 5 | 110 px | trajet ≤ 2 s | 23 |
| Mine télécommandée | 15 | 8 s | 4 (6 posées) | explosion 26 | jusqu'à l'ordre | 8 |
| Char d'assaut | 45 | 40 s | 2 | 8 passagers | 30 s | 26 |

Le grimpeur, compétence, arrive au niveau 4 (stock 3).

Logique du barème : les armes de mobilité (jetpack, grappin, tyrolienne) sont bon marché, rapides à recharger et sans
danger ; les armes de destruction coûtent plus cher que ce qu'elles économisent ; le satellite, qui coupe définitivement
le terrain, est le plus cher, le plus lent et arrive en fin de campagne. En duel, les 100 points de départ permettent
quatre à cinq tirs, puis 0,5 point par seconde ralentit les échanges.

### Progression de la campagne

| Niveau | Segments d'obstacles | Bidules | Objectif | Pièges | Brouillard |
|---|---|---|---|---|---|
| 4 | 2 | 21 | 51 % | 0 | non |
| 11 | 4 | 25 | 56 % | 1 | oui |
| 21 | 6 | 30 | 63 % | 3 | oui |
| 31 | 8 | 35 | 69 % | 5 | oui |
| 40 | 9 | 39 | 75 % | 6 | oui |

### Niveaux de l'ordinateur

| | Facile | Moyen | Difficile |
|---|---|---|---|
| Décision | toutes les 8 pas | toutes les 4 pas | toutes les 2 pas |
| Tolérance de déclenchement | 7 px | 3 px | 1 px |
| Erreurs | 25 % d'ordres oubliés ou gaspillés | 4 % | aucune |
| Route | aucune planification (regard à 40 px) | A* partiel, replanifié toutes les 12 s | A* partiel, replanifié toutes les 7 s |
| Armes | canon, à peu près | canon, drone, mine, bouclier | toutes : reconnaissance, drone, canon anticipé, satellite sur l'approche de la sortie adverse, mines, boucliers |
| Anticipation | non | non | tire là où le groupe sera, lit les ordres adverses, contre mines, obus, rayons et drones |

Mesures sur 6 cartes, camps échangés (12 parties par duel), reproductibles par `node tests/ai.test.js` :

| Duel | Résultat |
|---|---|
| Difficile contre Moyen, chemin seul (sans armes) | 4 victoires, 2, 6 nuls ; 13,3 Bidules sauvés contre 10,6 |
| Difficile (armé) contre Moyen sans armes | 10 victoires, 1, 1 nul ; 10,9 contre 3,5 |
| Moyen contre Facile | 5 victoires, 3, 4 nuls |
| Difficile contre Facile | 8 victoires, 2, 2 nuls |
| Difficile contre Moyen, tous armés | 4 victoires, 4, 4 nuls : égalité |

Lecture honnête : face à un joueur qui ne se défend pas par les armes, le Difficile gagne presque toujours ; entre deux
IA qui sabotent en permanence, les ponts détruits se compensent et l'issue tient du hasard.

## Arborescence

```
index.html                  page unique, charge les scripts dans l'ordre des dépendances
css/style.css               interface (mobile d'abord) et variables de couleur par univers
js/
  core/      constants.js (matériaux, constantes, équilibrage) rng.js mathx.js (trigonométrie déterministe)
  engine/    terrain.js (bitmap destructible, vue par camp)  simulation.js (monde, armées, commandes, fin de partie)
  bidules/   bidule.js (marche, chute, attente, noyade, sortie)
  skills/    registry.js + blocker builder digger miner basher floater bomber climber
  weapons/   registry.js + recon kdrone satellite cannon shield zipline jetpack grapple mine tank
  levels/    loader.js  level1-3.js (à la main)  generator.js (segments, cartes miroir)  campaign.js (40 niveaux, étoiles, sauvegarde)
  ai/        pathfinder.js (A* et simulations d'essai)  ai.js (contrôleur, trois profils, tactique des armes)
  render/    sprites.js themes.js camera.js particles.js renderer.js (entités, brouillard, thèmes)
  audio/     audio.js (effets, musique générative par univers)
  ui/        hud.js (compteurs, compétences, arsenal)  input.js (souris, molette, tactile, clavier)
  main.js    boucle, menus, visée des armes, résultats
levels/      niveaux exportés en JSON (campagne complète, carte de duel)
tests/       moteur, compétences, armes, campagne, IA (Node) et test de fumée navigateur
tools/export-levels.js
docs/ARCHITECTURE.md
```

## Tests

```bash
npm test                      # environ 1 minute : déterminisme, compétences, 16 tests d'armes, 37 niveaux générés
                              # joués par un robot, 40 niveaux au total, équité et hiérarchie de l'IA
node tests/browser-smoke.js   # navigateur réel (nécessite Playwright) : menus, arsenal, duel jusqu'aux résultats
```

## Ajouter du contenu

* **Compétence** : `js/skills/maCompetence.js` avec `Bidules.Skills.register({...})`, puis l'ajouter à `index.html` et `tests/helpers.js`.
* **Arme** : `js/weapons/monArme.js` avec `Bidules.Weapons.register({...})` (voir `js/weapons/registry.js`), une icône dans
  `render/sprites.js` et, si elle crée une entité, son dessin dans `render/renderer.js`. L'arsenal, les raccourcis, les stocks et
  la compatibilité IA/réseau viennent du registre.
* **Niveau écrit à la main** : copier `js/levels/level1.js`. **Univers** : une entrée dans `render/themes.js` et dans `campaign.js`.

Plan d'ensemble et justifications : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
