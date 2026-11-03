# Opération Mirage : les Bidules

Jeu de réflexion 2D en HTML5 Canvas, jouable au clavier et à la souris sur PC, au doigt sur mobile.
Une troupe de petits soldats-robots, les **Bidules**, sort d'une trappe et marche tout droit. Ils ne
s'arrêtent jamais : le joueur leur distribue des compétences pour creuser, bâtir, bloquer et franchir
les pièges du désert, afin d'en sauver un pourcentage donné avant la fin du chronomètre.

Nom, personnages, graphismes, sons et niveaux sont originaux. Rien n'est repris d'une licence existante.
Aucun fichier image ou audio : tout est généré par le code.

## Ouvrir le jeu en local

Aucun serveur, aucune installation, aucune dépendance.

1. Télécharger ou cloner le dépôt.
2. Ouvrir `index.html` dans un navigateur récent (Chrome, Edge, Firefox, Safari), par double-clic ou
   glisser-déposer dans la fenêtre.

Les scripts sont des scripts classiques et non des modules ES, ce qui permet l'ouverture directe en `file://`.

Pour tester sur un téléphone, servir le dossier sur le réseau local, par exemple :

```bash
python3 -m http.server 8000      # puis ouvrir http://<ip-du-poste>:8000 sur le téléphone
```

Le son démarre au premier appui (règle des navigateurs). Le bouton haut-parleur le coupe, le choix est mémorisé.

## Commandes

| Action | PC | Mobile |
|---|---|---|
| Choisir une compétence | boutons du bas, touches `1` à `7` | boutons du bas |
| Appliquer à un Bidule | clic gauche | appui |
| Zoomer | molette, `+` / `-` | pincement à deux doigts |
| Défiler | glisser, flèches, `Maj` + molette | glissement à deux doigts |
| Pause (les ordres restent possibles) | `P` ou `Espace` | bouton pause |
| Vitesse x2 / x4 | boutons, `F` pour alterner | boutons x2, x4 |
| Annuler la dernière compétence | `U` ou `Ctrl+Z` | bouton annuler |
| Cadence de la trappe | `PgUp` / `PgDn`, boutons + et - | boutons + et - |
| Son coupé / actif | `M` | bouton haut-parleur |
| Recommencer, menu, aide | `R`, `Échap`, `H` | menu en haut à droite |

Les chiffres utilisent `event.code` : sur un clavier AZERTY, la touche `&` sélectionne la compétence 1 sans `Maj`.

## Règles

* Chaque niveau fixe un nombre de Bidules, un objectif en pourcentage de sauvés, un temps limite et un stock de compétences.
* La **chute** est mortelle au-delà de 56 pixels. **Eau** et **lave** tuent. Sortir de la carte tue.
* Les Bidules grimpent les marches jusqu'à 5 pixels, descendent les pentes douces, font demi-tour devant un mur.
* La partie se termine quand tous les Bidules sont sortis ou perdus, ou quand le temps est écoulé.

### Compétences

| Touche | Compétence | Effet |
|---|---|---|
| 1 | Bloqueur | Se plante sur place, les autres font demi-tour à son contact. Définitif. |
| 2 | Bâtisseur | Pose 12 briques, soit un escalier de 24 pixels de dénivelé. Retient ceux qui le suivent pendant qu'il travaille. Peut être réassigné pendant sa pause finale pour enchaîner deux escaliers. |
| 3 | Creuseur | Creuse vers le bas, s'arrête sur la roche, tombe s'il débouche dans le vide. |
| 4 | Mineur | Perce un tunnel diagonal à 45 degrés, praticable à pied. |
| 5 | Foreur | Perce un tunnel horizontal. Abandonne après 16 pixels sans rien à creuser, recule devant la roche. |
| 6 | Parachute | Permanent. S'ouvre après 10 pixels de chute et annule le dégât. |
| 7 | Kamikaze | Compte à rebours de 5 secondes, puis explosion qui retire un disque de terrain (rayon 16). Ne blesse que lui. |

La **roche** (brun sombre) est indestructible. Le **sable** et les **briques** se creusent.

## Niveaux de démonstration

1. **Premiers pas** : un gouffre à franchir au bâtisseur, une colline à traverser au foreur.
2. **Le bloc creux** : bloqueur au bord du plateau, mineur pour rejoindre la galerie, second bloqueur devant la lave.
3. **Forteresse du mirage** : mur de sable au foreur, bassin d'eau, gouffre de lave coupé par un îlot (deux bâtisseurs successifs). Des kamikazes et un parachute restent disponibles pour improviser.

Les niveaux sont des objets JSON (voir `js/levels/loader.js` pour le format complet). Les mêmes données sont
exportées dans `levels/*.json` par `npm run export-levels`.

## Arborescence

```
index.html                  page unique, charge les scripts dans l'ordre des dépendances
css/style.css               interface (mobile d'abord, portrait et paysage)
js/
  core/
    constants.js            matériaux, constantes physiques, cadence de la trappe
    rng.js                  générateur pseudo-aléatoire à graine (mulberry32)
  engine/
    terrain.js              bitmap destructible : creuser, bâtir, rasteriser, empreinte
    simulation.js           monde, pas fixe 30 Hz, commandes, instantanés, fin de partie
  bidules/
    bidule.js               un Bidule, marche, chute, noyade, sortie, explosion
  skills/
    registry.js             registre des compétences (ajouter une compétence = un fichier)
    blocker.js builder.js digger.js miner.js basher.js floater.js bomber.js
  levels/
    loader.js               JSON vers terrain, image de masque, registre de niveaux
    level1.js level2.js level3.js
  render/
    sprites.js              sprites pixel art générés depuis des cartes de pixels texte
    camera.js               position, zoom, défilement, conversion écran/monde
    particles.js            particules d'explosion, poussière, étincelles
    renderer.js             dessin du monde, terrain mis à jour par zones
  audio/
    audio.js                effets et musique générative Web Audio, bouton muet
  ui/
    hud.js                  compteurs et barre de compétences (DOM)
    input.js                souris, molette, tactile, clavier
  main.js                   boucle principale, écrans titre, pause et résultat
levels/*.json               niveaux exportés
tests/                      tests Node (moteur) et test de fumée navigateur
tools/export-levels.js      export des niveaux en JSON
docs/ARCHITECTURE.md        choix d'architecture
```

## Tests

```bash
npm test                      # moteur sous Node : déterminisme, compétences, niveaux gagnables
node tests/browser-smoke.js   # navigateur réel (nécessite Playwright)
```

Les tests couvrent : exécutions identiques à graine égale, rediffusion depuis le journal de commandes,
annulation par instantané, chaque compétence sur un petit niveau, et une solution scriptée pour chacun des
trois niveaux de démonstration.

## Ajouter du contenu

* **Compétence** : créer `js/skills/maCompetence.js` qui appelle `Bidules.Skills.register({...})`, puis l'ajouter
  à `index.html` et à `tests/helpers.js`. La barre d'outils et les raccourcis (`1` à `9`) la prennent en compte.
* **Niveau** : copier `js/levels/level1.js`, modifier le JSON, ajouter le script dans `index.html` et `tests/helpers.js`.

Plan d'ensemble et justifications : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
