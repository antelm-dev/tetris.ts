# tetris.ts 1.2.0

<p align="center">
  <img src="docs/demo.gif" alt="tetris.ts — menu et partie en cours" width="340">
</p>

Un Tetris 3D écrit en TypeScript avec p5.js/WebGL, disponible comme application
Electron et comme application web. Les deux cibles utilisent le même moteur, le
même rendu et les mêmes règles de jeu.

La version 1.2.0 fait évoluer l'expérience autour du jeu — son, statistiques,
contrôles et réglages — et transforme le projet en monorepo. Les modes déjà
présents en 1.1.0 restent disponibles : Endless, Marathon, Sprint, Ultra et le
Versus local contre un bot.

## Nouveautés depuis la 1.1.0

### Son et retours de jeu

- Ajout d'un moteur audio Web Audio commun aux modes Solo et Versus.
- Effets sonores associés aux déplacements, rotations, chutes, verrouillages,
  T-spins, combos, back-to-back, Tetris, perfect clears, changements de niveau,
  réception de garbage et fins de partie.
- Priorités et limitation des voix simultanées pour éviter qu'une succession
  d'événements ne rende le mix illisible.
- Spatialisation en Versus : le joueur et le bot sont placés de côtés différents,
  avec un volume réduit pour le bot.
- Alerte de garbage synthétisée et variation légère de certains sons répétitifs.
- Volumes séparés pour la musique et les effets, plus un mute global, tous
  persistés dans les réglages.

> Le contrôleur de musique adaptative est prêt et suit le niveau de la partie,
> mais aucun morceau en boucle n'est fourni dans la 1.2.0. Le réglage « Music »
> n'a donc pas encore d'effet audible.

### Statistiques de carrière

Un nouvel écran **Statistics** conserve localement :

- le nombre de parties et le temps de jeu total ;
- le meilleur score et le meilleur temps en Sprint ;
- les Tetris, T-spins, perfect clears et le plus grand combo ;
- la répartition des sept pièces verrouillées ;
- l'historique des dix dernières parties, avec leur mode, score, lignes, durée
  et état de complétion.

Les anciens records sont repris pour initialiser le meilleur score et le meilleur
Sprint. Les statistiques détaillées ne peuvent toutefois pas être reconstruites
pour les parties jouées avant la 1.2.0.

### Contrôles et accessibilité

- Support des manettes via la Gamepad API : croix ou stick pour se déplacer,
  boutons pour tourner, hold, hard drop et pause.
- Commandes tactiles sur la version web, affichées automatiquement sur un écran
  à pointeur grossier ou forcées dans les réglages.
- Trois dispositions tactiles : séparée, à gauche ou à droite.
- Vibrations tactiles et retour haptique des manettes lorsque la plateforme les
  prend en charge.
- DAS réglable de 50 à 300 ms et ARR réglable de 10 à 100 ms.
- Possibilité de masquer la ghost piece.
- Les réglages existants de mouvement réduit, intensité du screen shake,
  quantité d'effets et indices persistants sont toujours disponibles.

Le clavier, la manette et le tactile passent par la même couche d'entrée. Ils
partagent donc les mêmes règles de répétition et peuvent être utilisés ensemble
sans perdre un appui déjà maintenu.

### Interface

- Ajout de l'écran de statistiques au menu principal.
- Réorganisation de l'écran Settings en sections Theme, Controls, Gameplay,
  Audio, Web touch controls et Comfort.
- Menu et HUD découpés en composants plus petits et réutilisables.
- Défilement des longs écrans au clavier, à la souris et à la molette.
- Pause du Versus corrigée : la pause du joueur gèle désormais aussi le bot.

### Architecture et maintenance

Le dépôt est maintenant un workspace pnpm :

```text
apps/
  tetris/        application Electron/web, IPC, serveur Express et tests
packages/
  engine/        moteur Tetris pur, sans DOM ni framework
  bot/           stratégie et contrôleur du bot
  renderer/      rendu p5/WebGL, HUD, entrées, réglages et audio
  records/       validation et stockage partagé des records
```

Cette séparation supprime les copies de logique entre Electron et le serveur web.
Le stockage des records est notamment centralisé dans `@tetris/records`, avec la
même validation, la même migration des anciens fichiers et la même sérialisation
des écritures sur les deux cibles.

Les tests couvrent maintenant aussi les statistiques, la migration des réglages,
le moteur audio, les priorités sonores et les nouveaux réglages de contrôle.

## Compatibilité avec la 1.1.0

- Les thèmes, touches et réglages déjà enregistrés dans `localStorage` restent
  lisibles ; les nouvelles options prennent leur valeur par défaut.
- Les records par mode conservent leur format versionné. L'ancien format
  `{ highScore }` est toujours migré vers le record Endless.
- Les statistiques de carrière utilisent une nouvelle clé locale indépendante
  des records.
- La structure interne et les chemins de développement ont changé. Les imports
  doivent désormais cibler les packages `@tetris/*` plutôt que les anciens
  dossiers du renderer.

## Installation

Le projet utilise pnpm :

```bash
pnpm install
```

### Développement

```bash
pnpm dev       # Vite + Rollup + Electron
pnpm dev:web   # Vite + API Express, sur http://localhost:5174
```

### Vérification

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

### Build et lancement

```bash
pnpm build
pnpm start

pnpm build:web
pnpm serve:web
```

### Docker

The root Dockerfile contains separate `web` and `api` runtime targets. Compose
starts the playable browser game on port 4000 and the Nest API on port 3000,
with a named volume preserving web high scores across container replacement.

```bash
cp .env.docker.example .env
# Replace JWT_SECRET in .env with a strong random value first.
docker compose up --build -d
```

Open <http://localhost:4000>. The service health endpoints are `/healthz` for
the web host and `/api/health` for the API.

The API currently uses its explicitly development-only in-memory user store,
so Compose defaults `API_NODE_ENV` to `development`. Set it to `production`
only after implementing the persistent `UserRepository` described in
`apps/api/README.md`.

Pour générer les installateurs :

```bash
pnpm dist
pnpm dist:win
pnpm dist:mac
pnpm dist:linux
```

## Fonctionnement des deux cibles

- **Electron** utilise Rollup pour les processus main/preload, Vite pour le
  renderer et un bridge IPC typé pour les records et les actions de fenêtre.
- **Web** utilise le même renderer, avec une petite API Express exposée sur
  `GET /api/records` et `POST /api/records`.
- Les records web sont stockés dans
  `apps/tetris/server/data/high-score.json`. Sous Electron, ils sont stockés
  dans le dossier `userData` de l'application.
- Les préférences et statistiques de carrière sont locales au renderer et ne
  sont pas synchronisées entre appareils.

## Limites connues de la 1.2.0

- La musique adaptative est silencieuse tant qu'aucune piste n'est ajoutée au
  manifeste audio.
- Les boutons tactiles ne sont créés que par l'entrée web, pas dans Electron.
- Le Versus reste un duel local contre le bot. Le backend NestJS et le protocole
  temps réel en cours de préparation ne sont pas intégrés à cette version.

## Licence

Distribué sous licence MIT. Voir [LICENSE](LICENSE).
