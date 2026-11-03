# Guide de déploiement

Le serveur est un seul processus Node qui sert **le jeu (fichiers statiques), le WebSocket (`/ws`) et l'API de niveaux
(`/api/levels`)**. Il n'y a rien d'autre à installer, ni base de données : les salons vivent en mémoire, les niveaux partagés dans
`DATA_DIR/levels.json`.

## En local

```bash
npm install
npm start                    # http://localhost:3000   (PORT=8080 npm start pour un autre port)
```

Ouvrir `http://localhost:3000` dans deux navigateurs (ou deux onglets en navigation privée pour deux joueurs distincts) :
« En ligne », créer un duel, rejoindre avec le code. Pour jouer depuis un téléphone sur le même réseau, ouvrir
`http://<ip-du-poste>:3000`. Attention : sans HTTPS, le service worker et l'installation PWA ne fonctionnent que sur
`localhost`, pas sur une adresse IP du réseau.

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | Port d'écoute. |
| `HOST` | 0.0.0.0 | Interface (mettre `127.0.0.1` derrière Nginx). |
| `DATA_DIR` | `./data` | Dossier des niveaux partagés (à persister). |
| `ALLOWED_ORIGINS` | (vide : tout) | Liste d'origines autorisées pour le WebSocket, séparées par des virgules : `https://jeu.example.org`. |
| `NET_GRACE_MS` | 30000 | Délai de grâce avant forfait d'un joueur déconnecté. |
| `NET_TIME_SCALE` | 1 | **Tests uniquement** : accélère l'horloge de partie. Ne jamais changer en production. |

## Option 1 : VPS (Debian/Ubuntu) avec Nginx et HTTPS

Prérequis : un nom de domaine (`jeu.example.org`) pointant vers le serveur.

```bash
# 1. Node 20 et Nginx
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

# 2. Le jeu
sudo useradd -r -m -d /opt/bidules bidules
sudo git clone <votre-dépôt> /opt/bidules && cd /opt/bidules
sudo npm ci --omit=dev && sudo chown -R bidules: /opt/bidules
sudo install -d -o bidules /var/lib/bidules

# 3. Le service (fichier fourni : deploy/bidules.service)
sudo cp deploy/bidules.service /etc/systemd/system/
sudo systemctl enable --now bidules
curl http://127.0.0.1:3000/healthz               # {"ok":true,"rooms":0,...}

# 4. Nginx (fichier fourni : deploy/nginx.conf, remplacer jeu.example.org)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/bidules
sudo ln -s /etc/nginx/sites-available/bidules /etc/nginx/sites-enabled/
# Premier certificat : commenter le bloc 443 le temps de l'obtenir, ou utiliser :
sudo certbot --nginx -d jeu.example.org
sudo nginx -t && sudo systemctl reload nginx
```

Points d'attention pour le WebSocket derrière Nginx :

* `proxy_http_version 1.1` et les en-têtes `Upgrade` / `Connection` sont **indispensables** sur `/ws`, sinon la connexion échoue
  silencieusement (code 400 ou 426).
* `proxy_read_timeout 3600s` : le défaut de 60 s couperait les connexions calmes. Le serveur envoie un ping toutes les 20 s.
* Le navigateur choisit `wss://` tout seul quand la page est en `https://`. Aucune configuration côté client.
* Pare-feu : n'ouvrir que 80 et 443 ; le port 3000 reste local (`HOST=127.0.0.1`).
* `ALLOWED_ORIGINS=https://jeu.example.org` interdit à une autre page web d'ouvrir un WebSocket vers votre serveur.

Mise à jour : `git pull && sudo npm ci --omit=dev && sudo systemctl restart bidules`. Redémarrer coupe les parties en cours
(les salons sont en mémoire) : choisir une heure creuse. Les joueurs se reconnectent automatiquement au salon vide... qui n'existe
plus ; ils reviennent au menu en ligne.

## Option 2 : Render

1. Pousser le dépôt sur GitHub/GitLab.
2. Render, **New > Blueprint**, choisir le dépôt : il lit `render.yaml` (service web Node, vérification `/healthz`, disque de 1 Go
   pour les niveaux).
3. Utiliser un plan **payant** (au minimum Starter) : le plan gratuit met le service en veille après 15 minutes, ce qui détruit
   salons et parties.
4. HTTPS et WebSocket (`wss://`) sont fournis par Render sans réglage.

## Option 3 : Fly.io

```bash
fly launch --no-deploy --copy-config            # reprend fly.toml ; choisir un nom d'application unique
fly volumes create bidules_data --size 1 --region cdg
fly deploy
fly status && curl https://<app>.fly.dev/healthz
```

* **Une seule machine** (`fly scale count 1`) : un salon vit dans la mémoire d'un processus ; deux machines enverraient les deux
  joueurs d'un même salon sur des processus différents.
* `auto_stop_machines = "off"` est déjà réglé : l'arrêt automatique détruirait les parties.
* HTTPS et WebSocket sont gérés par le proxy Fly.

## Docker seul

```bash
docker build -t bidules . && docker run -d --name bidules -p 8080:8080 -v bidules-data:/data bidules
```

## Passage à l'échelle et exploitation

* Un processus supporte confortablement quelques centaines de parties : le serveur exécute une simulation de 30 pas par seconde par
  partie (environ 0,1 ms par pas) et un salon pèse environ 1 Mo en mémoire. Au-delà, lancer plusieurs instances **avec une
  répartition par code de salon** (le code fixe l'instance : par exemple première lettre) ; le protocole ne change pas.
* Surveillance : `GET /healthz` renvoie `{ok, rooms, clients, playing}` ; les désynchronisations sont écrites dans le journal
  (`désynchronisation du joueur ...`).
* Sauvegarde : seul `DATA_DIR/levels.json` mérite d'être copié.
* Mises à jour du jeu : le service worker (nom de cache = empreinte des fichiers) renouvelle le cache des joueurs tout seul ;
  `npm start` régénère `sw-assets.js` avant de démarrer.
