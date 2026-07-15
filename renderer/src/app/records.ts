import { formatClock } from '../core/time'
import type { ModeId } from '../engine/modes'

/**
 * Per-mode Solo records — the versioned replacement for the old single
 * `{ highScore }` file. Shape and comparison rules are mirrored independently
 * in `main/ipc/game.ipc.ts` (Electron) and `server/high-scores.mjs` (web), the
 * same way the old single-score store already had two independent
 * implementations either side of that boundary.
 */

export interface EndlessRecord {
  score: number
}
export interface MarathonRecord {
  score: number
  /** Supporting data only — Marathon ranks by score, not by how long it took. */
  elapsedMs: number
}
export interface SprintRecord {
  timeMs: number
}
export interface UltraRecord {
  score: number
}

export interface RecordsState {
  endless: EndlessRecord | null
  marathon: MarathonRecord | null
  sprint: SprintRecord | null
  ultra: UltraRecord | null
}

export const EMPTY_RECORDS: RecordsState = { endless: null, marathon: null, sprint: null, ultra: null }

export type SubmitPayload =
  | { mode: 'endless'; score: number }
  | { mode: 'marathon'; score: number; elapsedMs: number }
  | { mode: 'sprint'; timeMs: number }
  | { mode: 'ultra'; score: number }

export interface SubmitResult {
  beaten: boolean
  records: RecordsState
}

/**
 * Submission for a run that ended in game over. `undefined` where that mode's
 * record only counts a *successful* completion (Sprint's time is meaningless
 * unless the 40 lines were actually cleared).
 */
export function gameOverSubmission(mode: ModeId, score: number, elapsedMs: number): SubmitPayload | undefined {
  switch (mode) {
    case 'endless':
      return { mode: 'endless', score }
    case 'marathon':
      return { mode: 'marathon', score, elapsedMs }
    case 'ultra':
      return { mode: 'ultra', score }
    case 'sprint':
      return undefined
  }
}

/** Submission for a successful mode completion. */
export function completionSubmission(mode: ModeId, score: number, elapsedMs: number): SubmitPayload | undefined {
  switch (mode) {
    case 'sprint':
      return { mode: 'sprint', timeMs: elapsedMs }
    case 'marathon':
      return { mode: 'marathon', score, elapsedMs }
    case 'ultra':
      return { mode: 'ultra', score }
    case 'endless':
      return undefined
  }
}

/** The score to show as "Best" for a mode that has one — 0 for Sprint (ranked by time, not score). */
export function bestScoreOf(records: RecordsState, mode: ModeId): number {
  const record = records[mode]
  if (!record) return 0
  return 'score' in record ? record.score : 0
}

/** Banner text for a just-beaten record, tailored to what that mode is ranked by. */
export function beatenBannerText(mode: ModeId, records: RecordsState): string {
  if (mode === 'sprint') {
    const record = records.sprint
    return record ? `New best time: ${formatClock(record.timeMs, true)}` : 'New best time!'
  }
  return `New high score: ${bestScoreOf(records, mode)}`
}
