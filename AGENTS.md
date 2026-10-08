# Workspace rules

## User interfaces

- HTML and CSS are not allowed for user interfaces.
- Always implement user interfaces with p5.js.
- Do not introduce HTML- or CSS-based UI frameworks or components.
- These rules apply to the game (`apps/tetris`, `packages/renderer`); internal developer tooling such as `apps/asset-manager` is exempt and may use HTML/CSS.

## Development

- Use TypeScript strict mode.
- Preserve existing public APIs unless explicitly asked to change them.
- Do not add production dependencies without approval.
- Keep changes focused on the requested task.

## Verification

- Run `npm run lint` after modifying code.
- Run `npm test` before declaring work complete.
- Report any checks that could not be run.

## Git

- Do not commit, push, or create branches unless explicitly requested.
- Never discard existing uncommitted changes.
