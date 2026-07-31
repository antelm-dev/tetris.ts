# Bugbot review guide

This is a pnpm TypeScript monorepo for an Electron and web Tetris application.
Review pull requests for functional regressions and security issues, not style issues that are already covered by Oxlint and Oxfmt.

## Architecture

- `packages/engine` is the pure, framework-free game engine. Keep its state transitions deterministic and do not add DOM, Electron, Node filesystem, or rendering dependencies.
- `packages/bot` evaluates placements using the engine. Changes must not mutate a game state that callers expect to reuse.
- `packages/renderer` is host-agnostic p5 UI code. It must communicate with platform services through its existing host and records interfaces.
- `apps/tetris/main` is the Electron main/preload boundary. Treat renderer-originated IPC data as untrusted, validate it, and do not expose arbitrary filesystem, shell, or external-URL access.
- `apps/tetris/renderer` is the browser/Electron renderer entrypoint. Avoid importing Electron or Node-only APIs here.
- `packages/records` owns score validation and file-backed persistence. Preserve validation, path containment, and safe handling of malformed stored data.

## Review priorities

Report only concrete, user-impacting defects. In particular, check for:

- Tetris invariants: pieces must stay within the field, collisions must be resolved before state is committed, line clears and score/level progression must remain consistent, and hold/rotation/garbage logic must not corrupt state.
- Time and input regressions: repeated key/touch events, paused or ended games, and delayed callbacks must not move or lock pieces unexpectedly.
- Electron security boundaries: IPC handlers and preload APIs must not broaden renderer privileges; external URLs must be validated before opening; file paths must remain inside their intended data directory.
- Cross-target compatibility: changes should work in both Electron and web modes without introducing browser-only APIs into the main process or Node/Electron-only APIs into web bundles.
- Persistence robustness: reject invalid score payloads, avoid losing existing records on malformed input, and handle absent/corrupt record files safely.

## Project checks

Use these commands as context when a change warrants verification:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not flag generated output, build artifacts, or sound/image assets unless a change causes a runtime or packaging failure.
