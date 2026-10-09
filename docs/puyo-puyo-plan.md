# Plan Puyo Puyo

Ajouter Puyo Puyo au monorepo en réutilisant le moteur, le bot, le renderer, le
versus local et l'online, avec le minimum de code nouveau. Ce plan part de
l'état actuel du code (lu le 2026-10-09) et cite les fichiers à toucher.

## 1. Règles retenues (Tsu, simplifiées)

| Règle | Choix | Pourquoi |
|---|---|---|
| Grille | 6 × 12 visibles + 1 ligne cachée (hauteur 13) | Standard Tsu. `Field` prend déjà `width`/`height` en option. |
| Pièce | paire de 2 puyos, 4 couleurs (rouge, vert, bleu, jaune) | Tsu. Pas de 5e couleur, pas de triple ni de quadruple. |
| Rotation | autour du puyo pivot, quick-turn si bloqué des deux côtés | Reproduite avec la boîte carrée 3×3 de `Piece` plus une table de kicks à 2 entrées. |
| Pop | groupe de 4+ puyos de même couleur, 4-connexité | Flood fill sur `field.slots`. |
| Chaîne | pop → chute → pop … jusqu'à stabilité | Boucle de résolution, chaque étape émise au renderer. |
| Score | `10 × puyos × max(1, chainPower + colorBonus + groupBonus)` | Table Tsu. |
| Nuisance | `score / 70` arrondi avec reste, 6 par ligne, jusqu'à 5 lignes par chute, offset | Standard. Remplace les lignes à trou. |
| Game over | la colonne 3 (index 2) est occupée à la ligne cachée | Standard Tsu. |
| Hold | absent | Puyo n'en a pas. L'action `hold` est acceptée et ignorée pour garder le protocole intact. |
| Sortie all clear | +30 nuisances envoyées à la prochaine chaîne | Standard. Réutilise `Field.isEmpty`. |

Hors périmètre v1 : modes Fever, règles Sun, marges de temps (margin time),
sprites ronds connectés, musique. Les cubes actuels suffisent pour jouer.

## 2. État des lieux : ce qui bloque, ce qui est gratuit

**Gratuit (réutilisé tel quel)**

- `Field` : `collides`, `checkCollision`, `isEmpty`, `clone`, `load`, `reset`.
- `Piece` : rotation par transposition dans une boîte carrée, `cells`, `move`.
- `Game` : patron `serialize`/`restore`/`replay`, `advance(dtMs)`, lock delay
  (`LOCK_DELAY`, `MAX_LOCK_RESETS`), `GameEvents`, `ModeDef`.
- `@tetris/bot` : `BotController` (n'utilise que `action`, `activePiece`,
  `gameOver`, `isPaused`), `generatePlacements`/`dropAt` (rotation × colonne via
  `Field.collides`).
- `@tetris/protocol` : `gameActionSchema`, les 8 actions, `PlayerAction`,
  `Snapshot`, `StateCorrection`, tick, rollback window.
- `apps/api` : `EngineGameSession`, historique/rollback, `matchGarbageSeed`.
- Renderer : `Gravity`, `PieceMotion`, `drawLockedField`, `drawBlock`, HUD,
  menu, réglages, entrées clavier/manette/tactile, audio, `Effects`, `Flashes`.

**Bloquant (les trois points Tetris câblés en dur)**

1. `Field.placePiece` écrit `piece.name` et scanne les lignes complètes.
2. `Slot = PieceName | 'GARBAGE' | 0` et tout ce qui est indexé par `PieceName` :
   `PALETTE`/`ThemePreset.pieces`, `WireSlot`, `StatisticsState.pieces`,
   `SLOT_ORDER` du menu, `drawPanel`, `pieceFromWire`.
3. Une seule couleur par pièce (`Piece.name`). Une paire Puyo est bicolore.

Plus des points diffus mais mécaniques : `COLS`/`ROWS` sont des constantes de
`core/geometry.ts` lues par `cellToWorld`, `drawWell`, `sidePanelX` ; `lines`
est partout (HUD, records, `ModeTarget`, `GameSnapshot`).

## 3. Architecture cible

```text
packages/
  engine/
    src/
      Field.ts         +writePiece, +findGroups, +collapse, +dropCells   (générique)
      Piece.ts         shape values = id de couleur (1..n), plus seulement 0/1
      types.ts         Slot = string | 0 ; GameEvents commun
      Game.ts          Tetris, inchangé sauf appel writePiece + clearFullRows
      puyo/
        const.ts       couleurs, kicks, tables de score/chaîne
        PuyoGame.ts    la simulation Puyo
        chain.ts       resolveChains(field) → ChainStep[]
        nuisance.ts    scoreToNuisance, nuisanceDrop(count, rng) → cells
        modes.ts       Endless, Sprint (N chaînes ou N nuisances), Ultra
  bot/
    src/
      placements.ts    inchangé (générique)
      puyo/evaluate.ts heuristique de chaîne
  protocol/            GameStartedPayload.game, GarbageDelivered.cells
  renderer/            scène paramétrée par Board (cols, rows), PALETTE par slot
apps/api/              GamesService instancie Tetris ou Puyo selon la room
```

Pas de « moteur générique » abstrait : Tetris garde `Game`, Puyo a `PuyoGame`.
Ce que les deux partagent passe par `Field`, `Piece` et une petite interface
structurelle que `VersusMatch`, `EngineGameSession` et `Input` consomment
déjà de fait.

## 4. Étapes, dans l'ordre

Chaque étape se termine par `npm run lint` et `npm test` verts et laisse
Tetris jouable. Les étapes 1 à 3 sont du refactor neutre ; Puyo commence à
l'étape 4.

### Étape 1. Couleur par cellule dans `Piece` et `Field` (neutre)

- `Piece.shape` garde `number[][]`, mais une valeur > 0 est un **id de
  couleur**. Pour Tetris, la valeur reste `1` et le slot écrit reste
  `piece.name`. Ajouter `Piece.slotAt(dx, dy)` : retourne `name` quand la
  valeur est 1 et qu'il n'y a pas de palette, sinon `colors[value]`.
  Concrètement : `Piece` reçoit un paramètre optionnel `colors?: readonly
  string[]` ; `slotAt` renvoie `colors ? colors[value - 1] : name`.
- `Field.writePiece(piece): { rows: Set<number>; lockOut: boolean }` : extrait
  la boucle d'écriture de `placePiece` et écrit `piece.slotAt`.
- `Field.clearFullRows(rows): number[]` : extrait le scan et l'effacement.
- `Field.placePiece` devient `writePiece` + `clearFullRows`. Signature et
  `lastCleared` inchangés : aucun appelant ne bouge.
- `Piece.rotate` : la transposition transporte déjà les valeurs, donc les
  couleurs tournent avec la forme. Rien à faire.
- Tests : `test/tetris/field.test.ts` ajoute un cas `writePiece` avec palette,
  `piece.test.ts` un cas `slotAt` après rotation.

### Étape 2. `Slot` générique et palette par slot (neutre)

- `types.ts` : `Slot = PieceName | 'GARBAGE' | 0` devient
  `Slot = string | 0`. `PieceName` reste exporté et utilisé par Tetris.
- Renderer `config/themes.ts` : `ThemePreset.pieces: Record<PieceName,
  Shade>` devient `slots: Record<string, Shade>`. `PALETTE` idem. Le thème
  `classic` ajoute les quatre slots Puyo `red`, `green`, `blue`, `yellow` et
  `NUISANCE` (réutiliser `GARBAGE_SHADE`). Les autres thèmes dérivent via
  `shades()` et tombent sur `PALETTE[slot] ?? GARBAGE_SHADE`.
- `drawLockedField`, `drawWireBoard`, `drawGhost`, `drawActive` : remplacer
  `PALETTE[slot]` par un helper `shadeOf(slot)` avec le fallback.
- `WireSlot` dans `protocol/messages.ts` devient `string | 0` avec un commentaire
  listant les valeurs par jeu. `WirePieceName` reste pour Tetris.
- Migration `localStorage` des thèmes : `settings.ts` lit le thème par `id`,
  pas par structure, donc rien à migrer. Vérifier dans
  `test/config` qu'un thème persisté avec l'ancien `pieces` charge encore.
- `StatisticsState.pieces` et `SLOT_ORDER` restent `PieceName` : ce sont des
  statistiques Tetris. Les stats Puyo arrivent à l'étape 9.

### Étape 3. Scène paramétrée par la taille de grille (neutre)

- `core/geometry.ts` : `cellToWorld`, `sidePanelX`, `sidePanelTop` lisent
  `COLS`/`ROWS` importés. Les remplacer par un objet module `board = { cols,
  rows }` avec `setBoard(cols, rows)`, valeurs par défaut Tetris. `drawWell`
  lit le même objet. Un seul point de mutation, appelé par `sketch.ts` au
  changement de jeu.
- shortcut: un seul `board` global, donc pas deux jeux de tailles différentes
  à l'écran en même temps ; à revoir si un versus Tetris contre Puyo est voulu.
- Test : `cellToWorld` sur 6×13 centre bien la colonne 2.5.

### Étape 4. Moteur Puyo (`packages/engine/src/puyo/`)

**`const.ts`**

- `PUYO_COLORS = ['red', 'green', 'blue', 'yellow'] as const`.
- `PAIR_SHAPE` : boîte 3×3, pivot au centre `[1][1]` = couleur 1, satellite au
  dessus `[0][1]` = couleur 2. Avec `Piece.rotate` la transposition fait tourner
  le satellite autour du centre : exactement la rotation Puyo.
- `PAIR_KICKS` : pour chaque transition, `[[0,0], [-1,0], [1,0], [0,-1]]`
  (essayer en place, puis pousser d'une colonne à l'opposé du mur, puis monter
  d'une ligne quand le satellite passe sous le sol). Quick-turn : si la
  rotation est refusée deux fois de suite dans la même direction sans
  mouvement entre, faire un demi-tour (`rotate` deux fois). Garder ce compteur
  dans l'état sérialisé.
- Tables Tsu : `CHAIN_POWER = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256,
  288, 320, 352, 384, 416, 448, 480, 512]`, `COLOR_BONUS = [0, 3, 6, 12, 24]`,
  `GROUP_BONUS` pour 4..11+ = `[0, 2, 3, 4, 5, 6, 7, 10]`.
- `NUISANCE_RATE = 70`, `NUISANCE_PER_ROW = width`, `MAX_NUISANCE_ROWS_PER_DROP = 5`.
- `POP_MS = 300`, `FALL_MS_PER_CELL = 40` : durées de phase. Elles sont dans le
  moteur et pas dans le renderer parce qu'elles décident **quand** la pièce
  suivante apparaît, donc elles font partie de la simulation déterministe.

**`chain.ts`** (pur, testable sans `PuyoGame`)

- `findGroups(field, minSize = 4): Group[]` : flood fill 4-connexe sur les slots
  colorés, ignore `NUISANCE` et la ligne cachée (row 0). Retourne
  `{ color, cells }`.
- `adjacentNuisance(field, groups): Cell[]` : nuisances touchant un groupe.
- `collapse(field): Move[]` : fait tomber chaque colonne, retourne les
  déplacements `(x, fromY, toY)` pour l'animation. Réutilise
  `Field.load` sur une copie plutôt que de manipuler `_slots` de l'extérieur.
- `resolveChains(field): ChainStep[]` : boucle `findGroups` → calcul du score de
  l'étape → effacement → `collapse`, jusqu'à zéro groupe. `ChainStep = { index,
  groups, nuisanceCleared, moves, score }`. Pure : clone le field, ne touche
  rien à la grille de la partie. `PuyoGame` l'appelle puis **rejoue** les
  étapes une à une au rythme de `POP_MS`/`FALL_MS_PER_CELL`.

**`nuisance.ts`**

- `scoreToNuisance(score, leftover): { count, leftover }`.
- `nuisanceDrop(count, width, random): NuisanceCell[]` : lignes complètes
  d'abord, puis le reste sur des colonnes tirées sans remise avec `random`.
  Retourne `{ x, y: -1 }` pour chaque puyo, le `collapse` les fait tomber.
  Même rôle que `Field.addGarbageRows` : reproductible depuis le wire.

**`PuyoGame.ts`**

Copie assumée de la structure de `Game` (environ 400 lignes), sans hériter :
hériter obligerait à neutraliser `hold`, `isSpin`, `applyScore`, le 7-bag, et
coûterait plus que la copie.

- État `phase: 'falling' | 'popping' | 'dropping' | 'spawning'` plus
  `phaseMs`, `chainSteps: ChainStep[]`, `chainIndex`, `nuisanceLeftover`,
  `pendingNuisance` (reçu, pas encore tombé), `allClearBonus`.
- `advance(dtMs)` : en `falling` même gravité/lock que Tetris. En `popping` et
  `dropping`, décrémente `phaseMs`, applique l'étape suivante au field, émet
  `onChainStep(step)`. Après la dernière étape : applique `pendingNuisance`
  (phase `dropping` à nouveau), puis spawn. Game over si `field.slots[0][2]`
  ou `[1][2]` est occupé après le spawn.
- `action(name)` : `hold` ignoré, `push` = hard drop, le reste identique.
  Pendant `popping`/`dropping` toute action sauf `pause` est ignorée.
- Génération : tirage uniforme de 2 couleurs par paire via `random`, avec la
  règle Tsu « les 2 premières paires n'utilisent que 3 couleurs ». Queue de
  2 paires visibles (`nextPieces`), consommée par la fin comme Tetris.
- `serialize`/`restore` : tous les champs ci-dessus, plus `rng` via
  `isStatefulRandom`. `replay` copié tel quel.
- `receiveGarbage(countOrCells)` : nombre (local, tirage via `random`) ou
  cellules explicites (online). S'accumule dans `pendingNuisance`, tombe après
  la prochaine chaîne ou au prochain lock sans chaîne.
- Événements : `GameEvents` existant plus `onChainStep?(step: ChainStep)`,
  `onNuisanceDrop?(cells)`. `onClear`, `onSpin`, `onB2B`, `onPerfectClear`,
  `onHold` ne sont jamais émis. `lines` compte les puyos effacés pour que
  `GameSnapshot.lines` et les HUD restent remplis sans champ nouveau.
- `project()` : même `GameProjection`, `activePiece.name` vaut
  `'red:blue'` (pivot:satellite) pour que `pieceFromWire` puisse reconstruire
  la paire sans table partagée.

**Modes `puyo/modes.ts`** : `endless`, `sprint` (envoyer 60 nuisances, temps),
`ultra` (3 min, score). Même `ModeDef`, `target.lines` réinterprété comme
puyos effacés. shortcut: le libellé « lines » du HUD affiche des puyos en
Puyo ; renommer le `StatKey` si ça gêne.

**Tests `apps/tetris/test/puyo/`** : `chain.test.ts` (groupe de 4, groupe de
3 non effacé, chaîne à 2 étapes, nuisance adjacente effacée, score Tsu d'une
chaîne de 3 connue), `nuisance.test.ts` (conversion 70, reste, répartition
offset déterministe avec `mulberry32`), `puyo-game.test.ts` (rotation et
quick-turn contre un mur, phases et durées, game over colonne 3, serialize →
restore → replay identique sur 200 ticks, comme `states-agree.test.ts`).

### Étape 5. Bot

- `generatePlacements` fonctionne déjà pour une paire (4 orientations ×
  colonnes). Ajouter `puyo/evaluate.ts` : `chainPotential(field)` qui, pour
  chaque couleur et chaque colonne, pose un puyo virtuel et compte la longueur
  de chaîne déclenchée via `resolveChains` (pure, donc sûre). Score = meilleure
  chaîne potentielle × 10 + puyos connectés en groupes de 2–3 × 2 −
  hauteur colonne 3 × 4 − nuisances en surface.
- `HeuristicStrategy` est typé sur `Game` et `PieceName` : le généraliser sur
  une interface `{ field, activePiece, nextPieces }` et rendre `evaluate` et
  `simulatePlacement` injectables. `DIFFICULTY_CONFIG` est réutilisé,
  `considerHold` devient inerte pour Puyo.
- Tests : `bot/puyo-evaluate.test.ts` (préfère déclencher une chaîne de 2 à
  poser au hasard) et le bot ne crashe pas sur 500 pièces.

### Étape 6. Versus local

- `VersusMatch` : remplacer le type `Game` par une interface `VersusGame`
  (`start`, `tick`, `update`, `action`, `receiveGarbage(number)`, `events`,
  `gameOver`, `isPaused`, `level`, `activePiece`, `field`, `nextPieces`,
  `holdPiece?`). `Game` et `PuyoGame` la satisfont structurellement.
- Attaque : pour Puyo, `onChainStep` cumule `scoreToNuisance(step.score)` dans
  `frameAttack`, plus `allClearBonus`. Le netting existant (`resolveAttacks`)
  gère l'offset Puyo à l'identique : on annule d'abord ce qu'on reçoit.
- La livraison se fait après la chaîne, pas au lock : brancher sur un nouvel
  événement `onChainEnd` plutôt que `onLock`. Pour Tetris, `onLock` reste.
- `buildSide(random, game: 'tetris' | 'puyo')`.
- `drawVersusBoard` dans `sketch.ts` : `drawPanel` du hold n'est dessiné que si
  `holdPiece !== undefined` est possible (Tetris). Le panneau next affiche la
  paire.
- Test `versus.test.ts` : un match Puyo bot contre bot se termine sans
  exception et la nuisance est bien offsettée.

### Étape 7. Menu, HUD, entrées

- `hud/menu` : une ligne `Game: Tetris / Puyo` en tête de Solo et de Versus,
  persistée dans `settings` (`game: 'tetris' | 'puyo'`). Les lignes de mode
  lisent `MODE_LIST` du jeu choisi.
- `sketch.ts` : `startSolo(modeId)` et le versus construisent `Game` ou
  `PuyoGame` selon `settings.game`, appellent `setBoard`, et reconstruisent
  `Input` (il prend un `game` dans son constructeur, déjà rebâti à chaque
  versus). Scène `'play'` inchangée.
- `wireEvents` : ajouter `onChainStep` → `Flashes` sur les cellules du groupe,
  `fx.burst` au centroïde, `audio.combo(step.index)` (réutiliser le son combo
  existant, pitch croissant avec `index`), `ui` affiche « 3 chain! » via
  `MoveCallout` existant. `onNuisanceDrop` → `audio.garbageReceived`.
- `Input` : `hold` est déjà une action, il est simplement sans effet. Les
  contrôles tactiles n'ont rien à changer.
- `PieceMotion` : `onSpawn`/`onRotate` fonctionnent. Pour l'animation de chute
  des puyos après un pop, utiliser `ChainStep.moves` avec `FALL_MS_PER_CELL`
  dans un petit `CellMotion` du renderer, ou en v1 un simple saut discret (le
  moteur avance par cellule de toute façon).
- Legend du HUD : masquer la ligne Hold en Puyo.

### Étape 8. Online

- `GameStartedPayload.game: 'tetris' | 'puyo'` (défaut `'tetris'` si absent,
  pour compatibilité). `roomCreatePayloadSchema.game` optionnel pour que
  l'hôte choisisse.
- `GarbageDeliveryPayload.rows` reste pour Tetris ; ajouter `cells?:
  { x: number }[]` pour Puyo (colonne par puyo, l'ordre fait foi). Un seul
  message, discriminé par la présence du champ. `PayloadSchemaVersion` reste
  à 1, le champ est optionnel.
- `GamesService.startMatch` : `new PuyoGame({ width: 6, height: 13, random:
  mulberry32(seed) })` quand la room est Puyo. `EngineGame` (le `Pick` dans
  `engine-game-session.ts`) est déjà structurel : `PuyoGame` le satisfait.
  `wirePlayer` branche `onChainStep` → `tickAttack += scoreToNuisance(...)` au
  lieu de `onClear`/`computeAttack`. `queueGarbage` tire les colonnes avec
  `match.garbageRng`.
- Rollback : `history` stocke `game.serialize()` ; les nouveaux champs de phase
  y sont, donc rien à faire. Vérifier avec un test `games.service.spec.ts`
  qu'une entrée tardive pendant une phase `popping` est rejouée à l'identique.
- Client `online.ts` : `OnlineClient` construit `Game` ; le paramétrer par
  `payload.game`. `drawWireBoard` est déjà générique après l'étape 2 ;
  `pieceFromWire` parse `'red:blue'` quand le nom contient `:`.
- Bump `PROTOCOL_VERSION` seulement si les champs optionnels ne suffisent pas.

### Étape 9. Records et statistiques

- `@tetris/records` : `ModeId` devient `'endless' | 'marathon' | 'sprint' |
  'ultra' | 'puyo-endless' | 'puyo-sprint' | 'puyo-ultra'`. `RECORDS_VERSION`
  passe à 3, la migration ajoute les clés à `null`. `EMPTY_RECORDS` idem.
- Statistiques : `StatisticsState.puyo?: { gamesPlayed, longestChain,
  nuisanceSent }`, optionnel pour que les fichiers v1 chargent. L'écran
  Statistics ajoute une section quand `puyo` existe.
- `completionSubmission`/`gameOverSubmission` dans `app/records.ts` : brancher
  les ids Puyo.

### Étape 10. Finitions (optionnel, après v1 jouable)

- Sprites ronds et puyos connectés (`drawBlock` avec un masque de voisinage).
- Table de kicks plus fidèle (rotation au-dessus de la ligne cachée).
- Marges de temps et règle Fever.

## 5. Ordre de livraison et taille estimée

| Étape | Taille | Dépend de |
|---|---|---|
| 1. Couleur par cellule | S | — |
| 2. Slot générique + palette | M | 1 |
| 3. Scène paramétrée | S | — |
| 4. Moteur Puyo + tests | L | 1 |
| 5. Bot | M | 4 |
| 6. Versus local | M | 2, 3, 4, 5 |
| 7. Menu / HUD / entrées | M | 2, 3, 4 |
| 8. Online | M | 4, 2 |
| 9. Records / stats | S | 4 |

Chemin minimal pour « Puyo solo jouable » : 1, 3, 4, 7. Versus bot : + 2, 5,
6. Online : + 8. Les étapes 1 à 3 peuvent être livrées comme une PR de refactor
sans Puyo dedans.

## 6. Risques

- **Désync online** : tout nouvel état de `PuyoGame` (phase, `phaseMs`,
  `chainSteps`, `pendingNuisance`, `nuisanceLeftover`, compteur quick-turn)
  doit être dans `serialize`. Le test « serialize → restore → replay » de
  l'étape 4 est la garde-fou, à écrire avant le reste.
- **`Slot` élargi** : chaque `PALETTE[slot]` sans fallback devient un `undefined`
  silencieux et un `drawBlock` qui plante. Grep `PALETTE[` et `pieces[` avant
  de fermer l'étape 2.
- **`lines` surchargé** : le HUD, les records et `ModeTarget` lisent `lines`.
  Réutiliser le champ évite une dizaine de fichiers, au prix d'un libellé
  à adapter.
- **Durées de phase dans le moteur** : si un jour le renderer veut des
  animations plus longues que `POP_MS`, il devra désynchroniser affichage et
  simulation. Acceptable en v1.
- **AGENTS.md** : pas de dépendance de production nouvelle, pas de HTML/CSS ;
  rien dans ce plan n'en demande.
