import type { Action as EngineAction, ActivePieceProjection, Slot } from '@tetris/engine'
import type { GameAction } from '@tetris/protocol'
import type { GameProjection, GarbageRow } from '@tetris/engine'

/**
 * The authoritative game session — the seam through which the server drives
 * the shared `@tetris/engine`. Given the same seed and ordered inputs, every
 * session reproduces the same run.
 */
export interface AuthoritativeGameSession {
  readonly userId: string
  readonly isOver: boolean
  readonly score: number
  readonly lines: number

  /**
   * Apply a client input. Returns whether the action was accepted. Stale,
   * duplicate, post-elimination, and versus-`pause` inputs return `false`.
   */
  applyAction(action: GameAction, seq: number): boolean

  /** Advance the deterministic simulation by `dtMs` milliseconds. */
  advance(dtMs: number): void

  /** Queue-free board projection for opponent snapshots. */
  project(): GameProjection

  /** Apply deterministic garbage rows (explicit holes). */
  receiveGarbage(rows: readonly GarbageRow[]): void

  /** Compact opponent view (includes board encoding). */
  snapshot(): GameSnapshot
}

export interface GameSnapshot {
  userId: string
  score: number
  lines: number
  level: number
  over: boolean
  board: Slot[][]
  activePiece?: ActivePieceProjection
}

export type _ActionsAligned = [GameAction] extends [EngineAction]
  ? [EngineAction] extends [GameAction]
    ? true
    : never
  : never
export const assertActionsAligned: _ActionsAligned = true
