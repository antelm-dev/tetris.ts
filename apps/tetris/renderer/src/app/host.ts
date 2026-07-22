import type { ModeId } from '@tetris/engine/modes'
import type { RecordsState, SubmitPayload, SubmitResult } from './records'

/**
 * What the sketch needs from whatever is hosting it. Both are optional and kept
 * as tiny interfaces, so the renderer stays decoupled from the Electron IPC
 * layer — and runs perfectly well in a plain browser tab without either.
 */

/** Per-mode Solo record persistence, backed by the Electron bridge or the web API. */
export interface HighScores {
  get: () => Promise<RecordsState>
  submit: (payload: SubmitPayload) => Promise<SubmitResult>
  /** Fired by a push event (Electron only — see `main.ts`'s no-op web version). */
  onBeaten: (cb: (mode: ModeId, records: RecordsState) => void) => void
}

/** Host capabilities the menu can offer. */
export interface Host {
  /** Wired to the window "close" IPC; without it the Quit row is hidden. */
  quit?: () => void
}
