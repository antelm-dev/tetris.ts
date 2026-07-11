/**
 * What the sketch needs from whatever is hosting it. Both are optional and kept
 * as tiny interfaces, so the renderer stays decoupled from the Electron IPC
 * layer — and runs perfectly well in a plain browser tab without either.
 */

/** High-score persistence, backed by the Electron bridge. */
export interface HighScores {
  get: () => Promise<number>
  submit: (score: number) => Promise<boolean>
  onBeaten: (cb: (score: number) => void) => void
}

/** Host capabilities the menu can offer. */
export interface Host {
  /** Wired to the window "close" IPC; without it the Quit row is hidden. */
  quit?: () => void
}
