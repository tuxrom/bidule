# Choix d'architecture

## Vue d'ensemble

```
 entrées (souris, tactile, clavier)
        |  commandes {tick, type, id, skill}
        v
  Simulation  ----- événements (sons, particules) ----->  Audio, Particules
  (pas fixe 30 Hz, déterministe, sans DOM)
        |  état : terrain, Bidules, compteurs
        v
  Renderer (canvas, 60 images/s visées)      HUD (DOM)
```

La simulation ne connaît ni le canvas, ni le temps réel, ni `Math.random()`. Elle reçoit des commandes
et produit un état et des événements. Tout le reste en dépend et ne la modifie jamais directement.

## Scripts classiques plutôt que modules ES

Les navigateurs bloquent `import` entre fichiers ouverts en `file://` (politique CORS). Le cahier des charges
demande un jeu qui s'ouvre sans serveur. Chaque fichier est donc une IIFE qui s'accroche à l'espace de noms
`Bidules`, et `index.html` les charge dans l'ordre des dépendances. L'effet secondaire utile : les mêmes
fichiers se chargent sous Node (`require`) pour les tests, car l'IIFE reçoit `window` ou `globalThis`.

## Terrain : un bitmap, un octet par pixel

`Terrain.data` est un `Uint8Array` de matériaux (air, sable, roche, brique, eau, lave). Creuser, miner,
exploser et bâtir écrivent dans ce tableau, et la physique des Bidules le relit pixel par pixel. Il n'existe
pas de seconde représentation (maillage, polygones) à tenir synchronisée.

* Les tables `SOLID` et `DIGGABLE` indexées par matériau rendent chaque test de collision à peu près gratuit.
* Un rectangle « sale » est cumulé à chaque modification. Le rendu ne repeint que cette zone dans un canvas hors
  écran de la taille du monde (`putImageData`), puis recopie la partie visible d'un seul `drawImage` sans lissage.
* La rasterisation des niveaux (rectangles, ellipses, polygones, profils d'altitude) est en entiers, donc
  identique sur toutes les machines.

## Simulation à pas fixe et déterministe

* Pas de 1/30 s. La boucle de rendu accumule le temps réel et exécute autant de pas que nécessaire (8 au plus
  par image). Les vitesses x2 et x4 multiplient le temps accumulé, sans jamais changer la durée d'un pas.
* Seul `RNG` (mulberry32, état sur 32 bits) fournit de l'aléa : gigue d'apparition à la trappe, bords irréguliers
  des cratères. Les particules, qui sont visuelles, utilisent `Math.random()` hors simulation.
* Les Bidules sont mis à jour dans l'ordre du tableau. Les arrondis sont des entiers : la position d'un Bidule
  est une cellule du bitmap et ne dérive pas.
* `Simulation.hash()` calcule une empreinte de tout l'état. `tests/determinism.test.js` vérifie que deux
  exécutions identiques ont la même empreinte à chaque pas et que la rediffusion du journal reproduit la partie.

### Préparation du multijoueur

Toute action du joueur est une **commande** sérialisable : `{tick, type: 'assign', id, skill}` ou
`{tick, type: 'rate', value}`. Les Bidules sont désignés par identifiant stable, jamais par coordonnées d'écran.
`Simulation.issue()` aujourd'hui fixe `tick` au pas courant et applique aussitôt. Dans un modèle à pas verrouillés
(lockstep), le serveur attribuerait un `tick` futur commun et diffuserait les commandes, et chaque client
exécuterait la même simulation. Un décalage se détecte en comparant les empreintes. Le journal `Simulation.log`
sert déjà de format de rediffusion.

## Bidules, états et compétences

Un Bidule est un objet de données (`x, y` aux pieds, `dir`, `state`, quelques compteurs). Son comportement est
une table `Behaviors[state](bidule, sim)`. `walk` et `fall` sont dans `bidule.js`. Chaque compétence est un
objet déclaratif (`id`, `canAssign`, `assign`, `update`) enregistré dans `Skills`, ce qui donne :

* ajout d'une compétence sans toucher au moteur : un fichier, un `register()` ;
* barre d'outils, stocks et raccourcis générés depuis le registre ;
* règles de remplacement d'outil centralisées (`isWorkState`).

La marche suit le relief avec trois constantes (`MAX_CLIMB` 5, `MAX_DROP` 3, hauteur du corps 10) et une seule
fonction, `Physics.tryWalk`, que réutilise aussi le bâtisseur.

Simplification de jeu assumée : un bâtisseur au travail agit comme un obstacle (zone de ±6 pixels), si bien
que les Bidules qui le suivent font demi-tour plutôt que de tomber au bout d'un escalier inachevé.

## Annulation

`Simulation.snapshot()` copie le terrain (un `Uint8Array`), les Bidules, les compteurs, l'état du générateur
aléatoire et la longueur du journal. Le jeu en empile un avant chaque compétence valide (30 au plus) et
`undo()` restaure le dernier. L'état revient exactement à l'instant de l'ordre : terrain, stock de
compétences et temps. Le test `restore` vérifie l'égalité des empreintes.

## Rendu

* Canvas 2D, `imageSmoothingEnabled = false`, zoom entier en pixels écran après chaque geste (`Camera.snap`).
* Sprites générés au démarrage depuis des cartes de pixels en texte, avec une version miroir par sprite.
* Ciel et trois couches de dunes pré-rendus une fois, parallaxe par simple décalage horizontal.
* Fond de paroi : les pixels souterrains creusés montrent une roche sombre plutôt que le ciel.
* Particules en tampons typés de taille fixe, sans allocation pendant le jeu.
* **Qualité adaptative** : si l'appareil tient moins de 40 images/s pendant 2 secondes, la résolution interne
  passe de 2x à 1,5x puis 1x. La simulation n'est pas touchée.

Mesures indicatives dans un Chromium sans GPU (rendu logiciel) : un pas de simulation coûte environ 0,05 ms avec
30 Bidules, une image environ 6 ms. Avec le processeur ralenti 4 fois, l'image passe d'environ 20 à environ 50 images/s une fois la
qualité adaptative descendue à 1x. La fluidité sur un vrai téléphone milieu de gamme n'a pas été mesurée.

## Entrées

Les Pointer Events unifient souris, doigt et stylet. Un appui tactile court sans déplacement applique la
compétence. Un doigt seul ne déplace jamais la carte. Deux doigts pincent et défilent, et le zoom reste centré
sur le milieu du geste. Pour viser au doigt, le rayon de sélection grandit (24 px d'écran) et préfère le
Bidule capable de recevoir la compétence choisie. `touch-action: none` coupe les gestes natifs du navigateur
sur le canvas. Le clavier lit `event.code` pour les chiffres afin de fonctionner sur AZERTY.

## Audio

Tout est synthétisé avec Web Audio : oscillateurs et bruit filtré pour les effets, une boucle générative en gamme
phrygienne dominante pour la musique, planifiée 250 ms à l'avance sur l'horloge audio. Les sons fréquents
(creuser, briques) sont limités en cadence. Le contexte démarre au premier geste de l'utilisateur et l'état muet
est enregistré dans `localStorage`.

## Format de niveau

Un objet JSON : dimensions, graine, trappe, sortie, nombre de Bidules, objectif en pourcentage, limite de temps,
stock de compétences, décor, et une liste d'opérations de dessin du terrain. `Loader.fromJSON()` lit un fichier,
`Loader.paintMask()` accepte à la place une image de masque (une couleur par matériau). Les niveaux fournis sont
des fichiers `.js` qui appellent `Loader.register()`, pour fonctionner sans `fetch`. `tools/export-levels.js`
produit les `.json` équivalents.

## Originalité

Personnages (soldats-robots turquoise à visière), décor (désert, dunes, mirages), noms, interface, sons et
niveaux sont créés pour ce projet. La mécanique générale (petites créatures qui marchent seules, à qui l'on
confie des compétences) relève du principe de jeu, non d'éléments protégés.

## Limites connues

* Pas de fluide : l'eau et la lave sont statiques. Les niveaux protègent leur fond par de la roche.
* Pas d'éditeur de niveaux, pas de réseau : seuls les fondements (commandes, déterminisme, empreintes) existent.
* La fluidité sur mobile reste à valider sur appareils réels.
