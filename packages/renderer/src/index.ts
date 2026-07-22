/**
 * Public surface of the host-agnostic game UI. Each host (Electron desktop,
 * web) supplies the `HighScores`/`Host` ports its own way and calls `render`;
 * everything else — the p5 sketch, HUD, audio, input, scenes — stays private
 * to this package. See `app/host.ts` for the port contracts.
 */
export { default as render } from './app/sketch'
export { EMPTY_RECORDS } from './app/records'
export type { HighScores, Host } from './app/host'
