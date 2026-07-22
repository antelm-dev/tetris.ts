/**
 * The Tetris bot: heuristic placement search over a {@link @tetris/engine}
 * game. Pure — it reads engine state and produces moves, touching neither p5
 * nor the DOM.
 */
export * from './types'
export * from './controller'
export * from './difficulty'
export * from './strategy'
export * from './placements'
export * from './evaluate'
