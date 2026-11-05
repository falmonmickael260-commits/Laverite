# BLACKOPS — Action ou Vérité

Jeu de soirée privé et synchronisé en temps réel. Un organisateur crée un salon, partage son lien, puis le serveur sélectionne automatiquement chaque joueur à son tour.

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

1. Créer un projet Railway à partir de **ce dépôt GitHub**.
2. Ajouter un service Redis dans le même projet.
3. Relier sa variable de connexion à `REDIS_URL` du service web, par exemple via une référence Railway vers `REDIS_URL` du service Redis.
4. Définir `NODE_ENV=production`. Railway fournit `PORT` automatiquement. Le `Dockerfile` et `railway.json` construisent l’application et utilisent `/api/health` comme contrôle de santé.
5. Générer un domaine HTTPS Railway. Les WebSockets Socket.IO utilisent le même domaine que l’application.
6. Conserver **une seule instance** du service web : l’état est durable dans Redis, mais le moteur des tours et les canaux Socket.IO résident dans ce processus. Une architecture à plusieurs instances demanderait un verrou distribué et l’adaptateur Redis Socket.IO.

Variables disponibles dans [`.env.example`](.env.example) : `SESSION_HOURS` (24 par défaut, 1 à 72), `MAX_UPLOAD_BYTES` (3 Mo par défaut), `REDIS_URL` et `PORT`.

## Fonctionnement

- Le lien privé contient un identifiant de salon aléatoire. Chaque participant reçoit un jeton distinct enregistré dans son navigateur pour revenir après une actualisation.
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

Pour le contrôle visuel local, démarrer `npm start`, puis exécuter `CHROME_PATH=/chemin/vers/chrome npm run test:browser`. Ce scénario ouvre deux contextes de navigateur indépendants, joue un tour et vérifie les débordements à 360 px, 390 px et 1440 px.
