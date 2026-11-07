# Protocole réseau

Transport : **WebSocket** (`ws://hôte/ws`, ou `wss://` derrière HTTPS), messages **JSON texte**, un objet par message, champ
`type` obligatoire. Taille maximale d'un message : 16 Ko. Le serveur ferme ou ignore tout le reste.

Version : `protocol = 3` (constante `Bidules.Net.PROTOCOL` dans `js/net/netdef.js`). Elle change à chaque modification des
règles de simulation ou des messages : un client d'une autre version est refusé (`error` code `version`), car deux versions
du moteur ne produiraient pas le même état.

## Principe de synchronisation : lockstep déterministe, serveur arbitre

```
client A --cmd--> SERVEUR --step{cmds}--> client A
client B --cmd-->         --step{cmds}--> client B
                 (le serveur exécute aussi la simulation et fait référence)
```

* Seules des **commandes** circulent, jamais d'état. Une commande tient en 30 à 80 octets.
* Un client PROPOSE un ordre (`cmd`). Le serveur lui donne un pas d'exécution `tick = pas courant + délai d'entrée`, un
  propriétaire (`player`, `by`) et un rang global, puis le diffuse à tous dans un lot `step`.
* Chaque client (et le serveur) exécute la même simulation, applique la commande exactement à ce pas, et n'avance jamais
  au-delà du pas autorisé par le dernier `step` reçu.
* L'horloge est celle du serveur : 30 pas par seconde. Elle n'attend pas le client le plus lent ; un client en retard
  accélère pour rattraper (jusqu'à x4).
* Toutes les 2 s de jeu (pas multiples de 60) chaque client envoie la somme de contrôle de son état ; le serveur la compare à
  la sienne.

### Délai d'entrée adaptatif

`délai = clamp(ceil((RTT/2 + 2 x gigue + 40 ms) / 33,3 ms), 3, 15)` pas, c'est-à-dire de 100 ms à 500 ms. Chaque client mesure son
RTT (`ping`/`pong` toutes les 2 s, toutes les 0,5 s au début) et le rapporte ; le serveur retient le pire des deux joueurs,
monte immédiatement quand la latence augmente et redescend d'un pas toutes les 2 s. Le délai courant est annoncé dans chaque
`step` et affiché à l'écran.

### Lots `step`

Un lot toutes les 3 ticks (100 ms) : `{from, to, cmds}`. Les lots sont contigus (`from` = `to` du lot précédent). Un trou
déclenche une demande de resynchronisation. Les commandes d'un lot ont un `tick` dans `[from, to-1]`.

## Cycle de vie

```
hello -> welcome
create | join -> room (à chaque changement)
settings (hôte) / ready -> room ; quand les deux sont prêts : countdown 3,2,1,0 -> start
(partie) cmd / hash / ping  <->  step / pong / peer / chat / desync / resync
end -> room (retour au salon, état « lobby »)
```

## Client vers serveur

| `type` | Champs | Rôle |
|---|---|---|
| `hello` | `protocol`, `name`, `token?` | Premier message obligatoire. Avec `token`, rattache le socket au joueur existant (reconnexion). |
| `ping` | `t`, `rtt` | `t` = horodatage client, `rtt` = dernier RTT mesuré (ms). |
| `create` | `mode`: `vs` \| `coop` | Crée un salon, le créateur en est l'hôte. |
| `join` | `code` | Rejoint le salon de code à 4 lettres. |
| `leave` | | Quitte le salon (hors partie). |
| `resign` | | Abandonne la partie en cours (duel : défaite ; coop : le partenaire continue seul). |
| `settings` | `settings` | Hôte seulement, en salon. Duel : `{segments 2-5, theme, traps 0-2}`. Coop : `{level 0-39}`. Les « prêts » sont remis à zéro. |
| `ready` | `ready`: bool | Quand les deux sont prêts, le compte à rebours démarre. |
| `cmd` | `c`: commande | Un ordre de jeu (voir plus bas). |
| `hash` | `tick`, `h` | Somme de contrôle de l'état au pas `tick`. |
| `resync` | | Demande la reconstruction complète (trou de lots). |
| `chat` | `code` | Un des 8 codes d'emoji : `gg nice oops wow angry think fire flag`. |

### Commandes (`cmd.c`)

| `type` | Champs | Effet |
|---|---|---|
| `assign` | `id`, `skill` | Donne une compétence au Bidule `id`. |
| `dismiss` | `id` | Élimine un de ses Bidules (compte comme perdu). |
| `release` | `id` | Libère un de ses bloqueurs, qui reprend sa marche. En coop : rôle qui a le bloqueur. |
| `rate` | `value` 1-99 | Cadence de la trappe. |
| `weapon` | `weapon` + selon l'arme : `x`,`y` / `id` / `x1`,`y1`,`x2`,`y2` / `angle`,`power` | Tire une arme. |
| `steer` | `x`, `y` | Cible du drone kamikaze. |
| `detonate` | `what?`: `mine` \| `drone` | Fait sauter les mines et/ou le drone. |

Le serveur **assainit** toute commande : champs inconnus supprimés, nombres bornés et arrondis, identifiants vérifiés. Il pose
lui-même `tick`, `player` (le camp : la place du joueur en duel, toujours 0 en coop) et `by` (la place de l'émetteur, pour les
statistiques). Ces trois champs reçus d'un client sont ignorés.

## Serveur vers client

| `type` | Champs | Rôle |
|---|---|---|
| `welcome` | `token`, `protocol`, `build`, `serverTime`, `inRoom` | Jeton de session, à garder (sessionStorage) pour se reconnecter. |
| `room` | `code`, `mode`, `settings`, `host`, `state`, `players[2]`, `you`, `delay` | État du salon : `players[i] = {slot, name, ready, connected}` ou `null` ; `state` = `lobby` \| `countdown` \| `playing` ; `you` = ta place. |
| `countdown` | `n` | 3, 2, 1, 0. |
| `start` | `config`, `slot`, `delay` | Début de partie. `config = {protocol, mode, seed, ...réglages}` : avec elle, chacun construit le même niveau. |
| `step` | `from`, `to`, `cmds[]`, `delay` | Lot de commandes ; autorise la simulation à avancer jusqu'au pas `to`. Chaque commande : `{tick, player, by, type, ...}`. |
| `pong` | `t`, `tick` | Réponse au ping. |
| `peer` | `slot`, `status`, `graceMs?` | `disconnected` (partie suspendue, `graceMs` avant abandon), `reconnected`, `left` (coop : le partenaire est parti). |
| `desync` | `tick`, `expected` | Ta somme de contrôle diffère de celle du serveur : un `resync` suit. |
| `resync` | `config`, `slot`, `log[]`, `to`, `delay` | Reconstruction : reconstruire la simulation depuis `config`, y mettre tout le `log`, l'exécuter jusqu'au pas `to`, puis reprendre les `step` (le premier a `from == to`). |
| `chat` | `slot`, `name`, `code` | Message rapide. |
| `reject` | `reason` | `bad-command`, `not-your-role`, `rate`, `paused`, `bad-state`. |
| `end` | `reason`, `winner`, `status`, `tick`, `hash`, `saved[]`, `dead[]`, `quit?` | Fin de partie. `reason` : `sim` (fin normale), `abandon`, `desync`. |
| `error` | `code`, `msg` | `version`, `bad-message`, `rate`, `room-not-found`, `room-full`, `not-host`, `bad-state`, `full`, `idle`, `server`. |

## Désynchronisation

1. Au pas 60, 120, ... chaque client envoie `hash`.
2. Le serveur compare à `sim.hash()` au même pas. Égalité : rien. Différence : `desync` puis `resync` au client fautif, qui se
   reconstruit en rejouant le journal (quelques centaines de pas par tranche, sans bloquer l'affichage).
3. Après 3 désynchronisations d'un même joueur dans une partie, le serveur clôt la partie (`end`, `reason: desync`, sans vainqueur).

La somme de contrôle porte sur : terrain, pas, générateur aléatoire, joueurs (compteurs, points, recharges, stocks,
brouillage, reconnaissance), Bidules (position, état, compteurs), entités (position), pièges.

## Reconnexion et abandon

* Perte de socket en partie : le serveur **suspend** l'horloge, prévient l'autre (`peer disconnected`, délai de grâce de 30 s) et
  garde la place. Chaque joueur dispose de 90 s de suspension par partie au total.
* Le client réessaie seul (0,4 s, 0,8 s, 1,6 s... jusqu'à 8 s), renvoie `hello` avec son `token`, reçoit `room` puis `resync`,
  se reconstruit, et la partie reprend quand tout le monde est de retour (`peer reconnected`).
* Délai de grâce écoulé, ou `resign` : duel, défaite par abandon de l'absent (`end`, `reason: abandon`, `winner`, `quit`) ;
  coop, le partenaire est retiré de la partie, l'autre hérite de tous les rôles et la partie reprend.
* Hors partie (salon ou compte à rebours), une déconnexion retire simplement le joueur du salon.

## Coopération

Une seule armée (`players[0]`), deux émetteurs. Rôles imposés par le serveur (`Bidules.Net.COOP_ROLES`) :

| Place | Rôle | Compétences | Armes | Pilotage drone, mines |
|---|---|---|---|---|
| 0 | Ingénieur | bâtisseur, bloqueur, grimpeur, parachute | reconnaissance, bouclier, tyrolienne, jetpack, grappin, char | non |
| 1 | Démolisseur | creuseur, mineur, foreur, kamikaze | drone kamikaze, canon, satellite, mine | oui |

Une commande hors rôle reçoit `reject`/`not-your-role`. Points, stocks et recharges sont communs. Si l'un des deux part, l'autre
peut tout faire.

## Limites et sécurité

* Débit : 80 messages par seconde et par socket, 25 commandes par seconde et par joueur, 1 emoji toutes les 0,8 s.
* Le chat ne transporte que des codes fixes : aucun texte libre, donc rien à modérer ni à échapper côté réception.
* Les noms sont filtrés (lettres, chiffres, espace, tiret, 16 caractères).
* Le serveur ne fait jamais confiance au client : `player`, `tick`, `by` sont les siens ; stocks, points et recharges sont ceux de
  sa propre simulation.
* **Limite connue du lockstep** : chaque client simule tout, donc connaît la position des Bidules adverses cachés par le
  brouillard. Un client modifié pourrait les lire. Le brouillard est une règle d'affichage, pas une protection contre la triche ;
  un jeu compétitif exigerait des instantanés filtrés par joueur.

## Exemple de session (duel)

```
A: {"type":"hello","protocol":1,"name":"Alice"}            S: {"type":"welcome","token":"9f3c..."}
A: {"type":"create","mode":"vs"}                           S: {"type":"room","code":"AMPW","you":0,...}
B: {"type":"join","code":"AMPW"}                           S: room (aux deux)
A,B: {"type":"ready","ready":true}                         S: countdown 3, 2, 1, 0 ; start {config:{seed:48213,...},slot:0|1,delay:4}
A: {"type":"cmd","c":{"type":"assign","id":3,"skill":"builder"}}
S -> A,B: {"type":"step","from":300,"to":303,"delay":4,"cmds":[{"tick":304... }]}  (lot suivant)
A,B: {"type":"hash","tick":300,"h":3253168447}             (le serveur compare à la sienne)
S -> A,B: {"type":"end","reason":"sim","status":"won","tick":1642,"hash":...}
```
