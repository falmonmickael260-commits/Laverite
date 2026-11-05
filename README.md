# BLACKOPS — Action ou Vérité

Jeu de soirée privé et synchronisé en temps réel. Un organisateur crée un salon, partage son code de six caractères ou son lien, puis le serveur sélectionne automatiquement chaque joueur à son tour.

## Développement

Prérequis : Node.js 24 et, pour un stockage persistant entre redémarrages, Redis 7 ou plus récent.

```bash
cp .env.example .env
npm ci
npm run dev
```

Le client Vite est accessible sur `http://localhost:5173` et relaie l’API/WebSocket vers le serveur sur le port 3000. Sans `REDIS_URL`, le développement utilise une mémoire locale non persistante. En production, `REDIS_URL` est obligatoire.

```bash
npm run validate:content
npm test
npm run build
npm start
```

## Déploiement Railway

1. Installer la CLI Railway, se connecter et lier un projet Railway : `npm i -g @railway/cli`, `railway login`, puis `railway link`.
2. Examiner le plan Infrastructure as Code avec `railway config plan`. Le fichier [`.railway/railway.ts`](.railway/railway.ts) déclare **ce dépôt GitHub**, un service web à une instance et Redis avec `REDIS_URL` lié automatiquement.
3. Appliquer le plan avec `railway config apply`. L’intégration GitHub Railway doit pouvoir accéder au dépôt.
4. Générer un domaine HTTPS Railway pour le service web. Railway fournit `PORT` automatiquement ; le `Dockerfile` construit l’application et `/api/health` contrôle la connexion à Redis.
5. Conserver **une seule instance** du service web : l’état est durable dans Redis, mais le moteur des tours et les canaux Socket.IO résident dans ce processus. Une architecture à plusieurs instances demanderait un verrou distribué et l’adaptateur Redis Socket.IO.

**Attention :** un déploiement direct du dépôt GitHub ne crée pas automatiquement les ressources de `.railway/railway.ts`. Il faut appliquer le plan IaC, ou ajouter Redis manuellement et définir `REDIS_URL` sur le service `Laverite`, avant que le serveur puisse démarrer en production.

Variables disponibles dans [`.env.example`](.env.example) : `SESSION_HOURS` (24 par défaut, 1 à 72), `MAX_UPLOAD_BYTES` (3 Mo par défaut), `REDIS_URL` et `PORT`.

## Fonctionnement

- Le lien privé contient un identifiant de salon aléatoire. Chaque participant reçoit un jeton distinct enregistré dans son navigateur pour revenir après une actualisation.
- Le code court est réservé au salon jusqu’à son expiration. Il peut être saisi sur l’accueil sans approbation manuelle, avant ou pendant la partie. Un nouvel arrivant entre dans la rotation du cycle en cours.
- Le serveur vérifie le jeton à chaque commande et chaque accès aux photos. Les jetons ne sont jamais inclus dans l’état diffusé.
- Le tirage conserve une file mélangée des joueurs présents. Chaque joueur passe une fois par cycle ; la frontière entre cycles évite un deuxième tour consécutif lorsque plusieurs personnes jouent.
- Les contenus utilisés sont conservés dans l’état Redis jusqu’à épuisement de leur réserve éligible. Le niveau choisi par l’organisateur filtre la sélection.
- Les photos sont stockées dans Redis et accessibles uniquement aux membres du salon. L’auteur peut supprimer sa photo. Les clés du salon et des photos expirent automatiquement avec la session ; les réponses orales ne sont pas enregistrées.
- Une perte de connexion conserve le jeton du joueur. Si la personne sélectionnée ne revient pas sous quinze secondes, le serveur passe au tour suivant. Un départ volontaire la retire immédiatement.
- Les sons locaux restent désactivés tant que l’utilisateur ne les a pas activés. Le réglage de réduction des animations est conservé dans le navigateur.

## Vérification

Les tests couvrent les pseudos en double, une rotation de 30 joueurs, les non répétitions avant épuisement, l’expiration, les permissions, la synchronisation des tours, les photos, les réactions, les cadeaux, la reconnexion, la pause et la fermeture.

Le catalogue [`shared/content.generated.json`](shared/content.generated.json) contient les 1 000 vérités et 500 actions rédigées individuellement. Les sources éditables sont [`shared/content.ts`](shared/content.ts) et [`shared/extra-content.ts`](shared/extra-content.ts). Après une modification : `npm run export:content`, puis `npm run validate:content`.

Le validateur vérifie les comptes par catégorie, les identifiants, les contenus vides, les doublons textuels exacts, les formulations très proches et des termes interdits. Une revue humaine reste utile pour les ressemblances de sens que les tests automatiques ne peuvent pas déceler.

Pour le contrôle visuel local, démarrer `npm start`, puis exécuter `CHROME_PATH=/chemin/vers/chrome npm run test:browser`. Ce scénario ouvre trois contextes indépendants, dont un joueur entrant avec le code pendant la partie, et vérifie les débordements à 360 px, 390 px et 1440 px.
