# Changelog

## [1.2.0](https://github.com/antelm-dev/tetris.ts/compare/tetris.ts-v1.1.0...tetris.ts-v1.2.0) (2026-07-31)


### Features

* about menu added ([8ad06ec](https://github.com/antelm-dev/tetris.ts/commit/8ad06ecf76d70c612ceca39f89d6300568b663a3))
* add audio management and touch control settings, enhance game statistics tracking ([f7b1a34](https://github.com/antelm-dev/tetris.ts/commit/f7b1a34573afd0c1b429005f8f9b5f2aa1e508cf))
* add initial styles, sound effects, and event handling for Tetris game ([969c6b3](https://github.com/antelm-dev/tetris.ts/commit/969c6b30e283d5b5fb3035b77bde19439d2a18b0))
* add root files for new nestjs api package ([c3ef89b](https://github.com/antelm-dev/tetris.ts/commit/c3ef89b74cc5f98ae4381dc0a71f3506ce6f6f81))
* **api:** add authoritative multiplayer match loop ([3381c87](https://github.com/antelm-dev/tetris.ts/commit/3381c87c88448853637870f7bb4df6fe070bb794))
* **api:** run authoritative two-player match loop ([1842bfc](https://github.com/antelm-dev/tetris.ts/commit/1842bfca28bb8dc287b4caeaf488ea799cabcb65))
* **api:** wire gateway start/actions to the match loop ([bb5738c](https://github.com/antelm-dev/tetris.ts/commit/bb5738ce7f6ab304be125fa615d5597d30824b60))
* **desktop:** add electron-updater auto-updates ([c53e78f](https://github.com/antelm-dev/tetris.ts/commit/c53e78f55f7b43dd9722b0d60b76cdf690db7d9f))
* **engine:** add millisecond advance and board projection ([4169b41](https://github.com/antelm-dev/tetris.ts/commit/4169b417087a5584846c35f0e5ded4481f76679c))
* **engine:** export shared mulberry32 for online match seeding ([d4488f8](https://github.com/antelm-dev/tetris.ts/commit/d4488f8585466b019445d54699226dd5feac8e37))
* **protocol:** define match action-ack, snapshot, and garbage payloads ([8e9f9cf](https://github.com/antelm-dev/tetris.ts/commit/8e9f9cfe8455f93e48f0c3cd1f1cf9d8123d2888))
* **renderer:** add hidden online match client ([f87d889](https://github.com/antelm-dev/tetris.ts/commit/f87d8899dff29d4eb41adb261c2beafc45382a42))
* **renderer:** add online lobby overlay, HUD, and remote board drawers ([0ac0849](https://github.com/antelm-dev/tetris.ts/commit/0ac08496d921e9e3e6001a4278a1263f7848326d))
* **renderer:** draw the online lobby with p5 instead of DOM ([e1fdd7c](https://github.com/antelm-dev/tetris.ts/commit/e1fdd7cd1d828265bab41c876fc07703cf43a7de))
* **renderer:** wire Online Versus menu route and playable scene ([1c7c851](https://github.com/antelm-dev/tetris.ts/commit/1c7c8512c93493a2691975bef31136640e0aa301))


### Bug Fixes

* **api:** enforce one current room per socket ([3ef9c61](https://github.com/antelm-dev/tetris.ts/commit/3ef9c614d7d918f31b272a94eef7df17576c53bc))
* **api:** reject duplicate match sockets ([d22f683](https://github.com/antelm-dev/tetris.ts/commit/d22f68318a1dc7d42b38b37a99b1bd3b6b03fccc))
* **api:** use the published match seed for both piece bags ([1cc7a70](https://github.com/antelm-dev/tetris.ts/commit/1cc7a70c17d7d3c36c67941a6f48bb6033b5760e))
* **desktop:** keep online features disabled ([2a93c88](https://github.com/antelm-dev/tetris.ts/commit/2a93c88db453047eb4b637725fa9df3ec0068f08))
* **renderer:** apply online client review blocking fixes ([1adb000](https://github.com/antelm-dev/tetris.ts/commit/1adb0000b98a85234e663d280d58214924a85dae))
* **renderer:** let lobby submit own FormData activations ([be1ec62](https://github.com/antelm-dev/tetris.ts/commit/be1ec62d2bb96ace87529fcf5fd84725764567a0))
* **renderer:** preserve Online lobby fields across client re-renders ([fc3bfec](https://github.com/antelm-dev/tetris.ts/commit/fc3bfec4cca284795e2ce2fbff403384b4341651))
* resolve ci typecheck ([fe77261](https://github.com/antelm-dev/tetris.ts/commit/fe772614cf448140cdd361bb9c7446668eb457ac))
* resolve lint error ([c7ddb2b](https://github.com/antelm-dev/tetris.ts/commit/c7ddb2b2ff5196ae852d9d2b86e91b6fb52f79a6))
* restore online build defaults ([ac535bc](https://github.com/antelm-dev/tetris.ts/commit/ac535bc9d31ef900804a0fce75de0937b0f085d1))
* **tetris:** load package-root Vite env and keep Online UI off by default ([930a33b](https://github.com/antelm-dev/tetris.ts/commit/930a33bfc2594a58f49269949fe636cfd30cb428))

## [1.1.0](https://github.com/antelm-dev/tetris.ts/compare/tetris.ts-v1.0.0...tetris.ts-v1.1.0) (2026-07-15)


### Features

* **ci:** automate versioning and Electron releases ([70a2d94](https://github.com/antelm-dev/tetris.ts/commit/70a2d94a81e4d651b4e41e0daff5fa72740dc2a6))
* update game record handling and enhance IPC communication for solo and versus modes ([0da6284](https://github.com/antelm-dev/tetris.ts/commit/0da628436752c206f1c4561b08d59fbcb87ce206))
