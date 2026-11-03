# Choix d'architecture

## Vue d'ensemble

```
 humain (souris, tactile, clavier)        IA (ai/ai.js)
        |  commandes {tick, player, type, ...}   |
        +------------------+---------------------+
                           v
                 Simulation.issue()                      <- UNE seule porte d'entrée
                           |
   Simulation (pas fixe 30 Hz, déterministe, sans DOM)
     players[0..1] : trappe, sortie, stocks, points, recharges
     bidules, entités (armes), pièges, terrain bitmap
                           |  événements (sons, particules)
          +----------------+-----------------+
          v                                  v
   Renderer (canvas) + HUD (DOM)         Audio, Particules
```

La simulation ne connaît ni le canvas, ni le temps réel, ni `Math.random()`. Elle reçoit des **commandes** et produit un
état et des événements. Le joueur humain, l'IA et, plus tard, un adversaire réseau passent par la même fonction.

## Scripts classiques plutôt que modules ES

Les navigateurs bloquent `import` entre fichiers ouverts en `file://`. Chaque fichier est une IIFE qui s'accroche à
l'espace de noms `Bidules`, chargé dans l'ordre des dépendances par `index.html`. Les mêmes fichiers se chargent sous
Node (`require`), car l'IIFE reçoit `window` ou `globalThis` : les tests exécutent le vrai moteur.

## Terrain : un bitmap, un octet par pixel

`Terrain.data` est un `Uint8Array` de matériaux (air, sable, roche, brique du camp 0, brique du camp 1, eau, lave).
Creuser, miner, exploser et bâtir écrivent dans ce tableau et la physique le relit pixel par pixel. Un rectangle « sale »
est cumulé à chaque modification ; le rendu ne repeint que celui-ci.

**Briques par camp.** Deux armées qui bâtissent des escaliers en sens inverse sur le même terrain se verrouilleraient
mutuellement. Les briques du camp 0 et du camp 1 sont deux matériaux, et `Terrain.setViewer(camp)` choisit la table de
solidité : une brique n'est solide que pour son camp. La simulation fixe le point de vue avant de mettre à jour chaque
Bidule ; les obus, drones et explosions utilisent la vue neutre, pour qui tout est solide. Un bâtisseur peut poser ses
briques par-dessus celles de l'autre camp.

## Simulation à pas fixe et déterministe

* Pas de 1/30 s. La boucle de rendu accumule le temps réel et exécute jusqu'à 8 pas par image ; x2 et x4 multiplient le
  temps accumulé sans changer la durée d'un pas.
* Seul `RNG` (mulberry32) fournit de l'aléa : gigue d'apparition, bords irréguliers des cratères. Les particules, visuelles,
  utilisent `Math.random()` hors simulation.
* La balistique du canon utilise des flottants et une trigonométrie maison (`mathx.js`, série de Taylor sans `Math.sin`),
  car `Math.sin` n'est pas garanti identique d'un moteur JavaScript à l'autre.
* `Simulation.hash()` donne l'empreinte de tout l'état (terrain, Bidules, entités, points, recharges, pièges). Les tests
  vérifient que deux exécutions identiques ont la même empreinte à chaque pas et que la rediffusion du journal la retrouve.

### Armées et commandes

`players[i]` porte tout ce qui est propre à un camp : trappe, sortie, canon, stocks de compétences, stocks d'armes avec leur
recharge, points, cadence, compteurs et statistiques. Un niveau solo n'a qu'un joueur ; `sim.saved`, `sim.skills`,
`sim.rate`... pointent vers le joueur 0 pour garder la compatibilité avec le prototype.

Toute action est une commande sérialisable, désignant les Bidules par identifiant stable :

| Commande | Champs |
|---|---|
| `assign` | `player, id, skill` |
| `rate` | `player, value` |
| `weapon` | `player, weapon` et les paramètres de l'arme (`x, y`, `id`, `x1..y2`, `angle, power`) |
| `steer` | `player, x, y` (cible du drone kamikaze) |
| `detonate` | `player, what?` (mines et drones) |

`Simulation.issue()` fixe aujourd'hui `tick` au pas courant et applique aussitôt. Dans un modèle à pas verrouillés, un
serveur attribuerait un `tick` futur commun et diffuserait les commandes. Le journal `sim.log` sert déjà de format de rediffusion.

## Système d'armes

Une arme est un objet déclaratif enregistré dans `Weapons` (`weapons/registry.js`) :

```
id, label            identité stable (commandes, réseau)
cost, cooldown       coût en points, recharge en pas
stock                stock par défaut (les niveaux le surchargent)
target               mode de visée de l'interface : none, point, bidule, bidule-point, line, aim, pilot
validate(sim,p,cmd)  motif de refus ou null
fire(sim,p,cmd)      effet immédiat ou création d'une entité
kind / update(e,sim) si l'arme crée une entité : sa mise à jour à chaque pas
```

`Simulation.fireWeapon` fait les contrôles communs (stock, recharge, points) puis appelle `validate` et `fire`. Aucun
contrôle n'est répété dans les armes, et l'IA y est soumise comme le joueur.

Les armes durables sont des **entités** (`sim.entities`, données simples sérialisées dans les instantanés) : drone, obus,
rayon, bouclier, câble, mine, char. Celles qui transforment un Bidule lui donnent un **état** : `jet`, `grapple`, `zip`,
`rider`, avec un comportement enregistré dans `Behaviors`. Le dessin de chaque entité est séparé, dans `render/renderer.js`
(`ENTITY_DRAW`) ; la simulation n'a aucune dépendance au rendu.

Choix de conception notables :

* **Explosions** : `sim.blast(x, y, r, {owner, cause, lift})` creuse un cratère, tue au plus 3 Bidules non protégés,
  désamorce les pièges et détruit les mines du rayon. `lift` relève le centre : la calotte obtenue a des flancs
  praticables à pied, alors qu'un disque entier serait un puits de `r` pixels, infranchissable.
* **Plafond de victimes** : sans lui, une grappe de Bidules empilés disparaît sous une seule explosion et une arme décide
  seule de la partie (mesuré pendant la mise au point, voir « Équilibrage »).
* **Satellite** : seule arme qui perce la roche et n'a pas de fond. Son trou est permanent et gêne tout le monde sur le chemin
  commun ; l'IA ne le tire que derrière sa propre trappe, devant la sortie adverse.
* **Brouillard et pièges** : `sim.canSee(joueur, x, y)` est la seule source de vérité sur la visibilité, utilisée par le rendu
  et par l'IA. Les pièges cachés ne tuent que celui qui les déclenche et ne creusent rien.
* **Annulation** : `snapshot()` copie terrain, Bidules, joueurs, entités et pièges ; elle annule aussi les armes. Elle est
  désactivée en duel, où elle serait un avantage.

## Grimpeur, attente et obstacles

* Le **grimpeur** est une compétence permanente. `Physics.tryWalk` signale un mur ; pour un Bidule grimpeur il entre dans l'état
  `climb` (1 px tous les 2 pas jusqu'au rebord, abandon sous un plafond ou après 140 pas).
* **Attente** : un Bidule qui arrive derrière un bâtisseur, un foreur ou un mineur du même camp passe à l'état `wait`, se
  décale de 3 px de ses voisins et reprend sa marche dès que l'ouvrier est à plus de 12 px. Sans cela, les suivants
  tombaient au bout d'un escalier inachevé ou, renvoyés par un mur, retournaient se jeter dans le gouffre précédent.

## Campagne

`generator.js` compose les niveaux à partir de **segments** (gouffre, mur de sable, bassin, rebord de roche, îlot de lave,
marches, bloc creux). Chaque segment écrit ses opérations de terrain et un **plan de solution** (« quand un Bidule qui va
vers la droite passe entre x0 et x1, donner telle compétence »). La difficulté `d` (0 à 39) fixe nombre de segments,
effectif, objectif, pièges, brouillard et marge de stock.

`tests/campaign.test.js` rejoue chaque plan dans la vraie simulation avec un robot : les 37 niveaux générés sont gagnés. Les
niveaux écrits à la main sont gagnés par `tests/solutions.test.js`. Le plan est une aide de test : le jeu ne l'utilise jamais, et
l'IA ne le lit pas.

`campaign.js` contient le tableau de déblocage (`UNLOCK`, source unique), le calcul des étoiles et la sauvegarde
(`localStorage`, protégée par `try/catch`, avec repli silencieux). `index.html?debloquer` ouvre tous les niveaux.

## Carte de duel

`buildVS` tire au hasard la moitié gauche (gouffre, mur, bassin, rebord, îlot) et en copie le miroir exact : chaque opération
de terrain est reflétée autour du centre. Les marches et le bloc creux sont exclus : ils ne se lisent pas de la même façon
dans les deux sens. Pièges et décor sont placés en paires symétriques. `tests/ai.test.js` vérifie pixel par pixel que la carte
est un miroir, et que stocks, points et recharges de départ sont identiques.

## Architecture de l'IA

L'IA (`ai/ai.js`) est un **client** de la simulation. À chaque pas, avant `sim.step()`, `controller.update()` lit l'état public
et émet des commandes avec `sim.issue({player: 1, ...})`. Elle ne touche jamais directement un Bidule, un stock ou le
terrain, et ses commandes aboutissent dans le même journal que celles du joueur. Pour un adversaire réseau, il suffirait de
remplacer ce contrôleur par la réception des commandes distantes.

**Ce qu'elle voit** : tout le terrain (la carte est symétrique et connue), ses propres Bidules, et les Bidules adverses
seulement si `sim.canSee` l'autorise (brouillard, levé par son propre drone de reconnaissance). Elle lit aussi les ordres
adverses du journal, comme le ferait un pair réseau. **Ce qu'elle ne fait pas** : lire les stocks adverses, ni les mines et
Bidules cachés.

### Planificateur A* (`ai/pathfinder.js`)

* Nœud : un Bidule debout `(x, y, sens)`.
* Arêtes de **marche** : les mêmes règles que `Physics.tryWalk` (marche de 5 px, descente de 3 px), avec chute simulée
  jusqu'à l'appui suivant ; une chute mortelle, l'eau et la lave sont des arêtes interdites.
* Arêtes de **compétence** : près d'un obstacle (45 px devant), chaque outil (bâtisseur, foreur, mineur) est essayé dans une
  **simulation d'essai** (`Simulation.sandbox`) : un Bidule seul, sur une copie du terrain, avec la vraie physique. L'arête
  débouche là où il se remet à marcher. Aucune géométrie n'est codée à la main : si les règles du jeu changent, le
  planificateur suit.
* **Marge d'exécution** : l'IA ne décide que tous les `think` pas, donc le Bidule peut avoir avancé de `think - 1` pixels.
  Un point de départ n'est retenu que si l'outil réussit encore à cet écart.
* Heuristique : distance à la sortie. Plan **partiel** (2 actions) pour limiter le coût ; le creuseur est exclu (son puits
  laisse tomber tous les suivants).
* Les 40 niveaux de campagne sont planifiés sans lire leurs plans (39 sur 40, l'ancien niveau 2 manuel exigeant un demi-tour
  par bloqueur) ; coût typique : 50 à 190 ms par plan, replanifié toutes les 7 à 12 s et jamais pendant un chantier.

### Contrôleur et profils

| Mécanisme | Facile | Moyen | Difficile |
|---|---|---|---|
| Décision | `reactive()` : regard à 40 px | `planned()` : plan A* | idem, plus fréquent |
| Réflexes (`safety`) | non | oui | oui |
| Armes | canon | canon, drone, mine, bouclier | toutes, avec anticipation |

* **Réflexes** : un trou ou un mur peut surgir à tout moment (frappe adverse). Si un obstacle apparaît dans les 70 px devant le
  Bidule de tête sans outil prévu, replanification immédiate ; si un gouffre mortel est à moins de 14 px, un Bidule se sacrifie
  en bloqueur.
* **Tactique des armes** : regroupement des adversaires visibles en groupes pondérés (effectif, avancée vers leur sortie,
  ouvrage en cours repéré dans leurs ordres). Pour chaque arme : conditions d'emploi, vérification de tir ami, visée.
  Le **canon** cherche angle et puissance par balayage (`Weapons.cannon.solve`, le même calcul que l'interface du joueur) et,
  en Difficile, vise là où le groupe sera à l'impact. Le **drone** est piloté par `steer` ; la **mine** attend deux (Difficile) ou
  trois (Moyen) adversaires et aucun ami ; le **bouclier** couvre un groupe menacé par un obus (trajectoire prolongée), un
  rayon verrouillé, un drone ou une mine adverse visible ; la **reconnaissance** précède les frappes ; le **satellite** claque
  la porte devant la sortie adverse.
* **Combinaison** : reconnaissance (visibilité) puis drone et canon sur le groupe révélé, boucliers en défense.

### Équité, vérifiée par test

Stocks, points, recharges et carte identiques au départ ; toute commande de l'IA a `player` 0 ou 1 et un type connu ;
aucun stock n'est jamais négatif (les ordres de l'IA subissent les mêmes contrôles) ; deux parties à graine égale sont
identiques (même empreinte).

## Équilibrage : ce que les mesures ont changé

Le chiffrage complet est dans le README. La mise au point en duel a mis en évidence des défauts, tous corrigés :

* des cratères entiers de rayon 30 piégeaient les Bidules (flancs verticaux) : cratères en calotte (`lift`) ;
* une seule explosion tuait jusqu'à 11 Bidules empilés : plafond de 3 victimes ;
* les trous du satellite, tirés devant sa propre armée, la condamnaient : usage limité à l'approche de la sortie adverse ;
* des escaliers adverses solides bloquaient les deux armées : briques par camp ;
* des suivants renvoyés par un mur retombaient dans le gouffre derrière eux : état d'attente.

Résultat restant à signaler : entre deux IA armées, il n'y a pas d'écart mesurable entre Difficile et Moyen (4 victoires contre 4 sur 12 parties,
4 nuls), parce que les ponts détruits se compensent. La supériorité du Difficile est nette sur le chemin seul et face à un
adversaire qui ne tire pas.

## Rendu, entrées, audio

* Canvas 2D sans lissage, zoom entier après chaque geste, terrain en canvas hors écran repeint par zones, ciel et couches
  pré-rendus, qualité adaptative (2x, 1,5x, 1x) si l'appareil tient moins de 40 images/s.
* **Thèmes** (`render/themes.js`) : palette du sol, ciel, silhouettes d'arrière-plan (dunes, immeubles, montagnes, modules
  de station), étoiles, planète, aurore, décor, couleur d'accent de l'interface et gamme musicale.
* **Équipes** : deux palettes de sprites (turquoise, rouge), briques colorées par camp.
* **Brouillard** : canvas au quart de résolution rempli d'ombre et percé de disques doux autour des sources de vision du
  joueur, puis agrandi avec lissage.
* **Entrées** : Pointer Events unifiés ; un doigt applique ou vise, deux doigts pincent et défilent ; `touch-action: none` ;
  chiffres via `event.code` pour AZERTY. La visée du canon se fait en touchant la carte (le solveur de l'IA trouve angle et
  puissance), affinée par deux curseurs.
* **Audio** : effets et musique synthétisés par Web Audio ; la musique change de gamme, de tempo et de timbre selon l'univers.

## Limites connues

* Pas de fluide : eau et lave sont statiques. Pas d'éditeur de niveaux ni de réseau : seuls les fondements existent.
* L'IA n'emploie ni tyrolienne, ni jetpack, ni grappin, ni char ; elle ne sait pas se sortir de tous les pièges que le
  sabotage crée (un pont détruit pendant la traversée coûte des Bidules).
* Le niveau 2 écrit à la main (demi-tour par bloqueur) est hors de portée du planificateur.
* La fluidité sur un vrai téléphone n'a pas été mesurée. Dans un Chromium sans GPU, le duel contre l'IA difficile tourne à
  52 images/s en x4 ; le planificateur coûte 50 à 190 ms par plan (le premier plan, au départ, produit une image de 270 ms), soit une saccade visible sur appareil lent.
