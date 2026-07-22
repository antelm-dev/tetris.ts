import type { Action as EngineAction } from '@tetris/engine'
import type { GameAction } from '@tetris/protocol'

/**
 * The authoritative game session — the seam through which the *server* drives
 * the shared `@tetris/engine`. The engine is already pure and deterministic
 * (it takes an injectable RNG), which is exactly what an authoritative server
 * needs: given the same seed and the same ordered inputs, every session
 * reproduces the same run, so the server can validate or re-simulate what a
 * client claims happened.
 *
 * This is intentionally an *interface* for now. The full multiplayer loop is a
 * later step; here we lock down the contract so the realtime and games layers
 * can be written against it without depending on the engine at runtime.
 *
 * The engine's `Action` union and the protocol's `GameAction` are the same set
 * of strings; {@link assertActionsAligned} pins that at compile time so the two
 * packages can evolve without silently drifting.
 */
export interface AuthoritativeGameSession {
  /** The player this session simulates. */
  readonly userId: string

  /** True once the engine reports game over / top-out. */
  readonly isOver: boolean

  /**
   * Apply a client input. `seq` is the client's per-connection sequence number;
   * the session ignores stale or duplicate sequences so out-of-order socket
   * delivery can't rewind the simulation.
   */
  applyAction(action: GameAction, seq: number): void

  /** Advance the deterministic simulation by `dtMs` milliseconds (gravity, lock delay, …). */
  advance(dtMs: number): void

  /**
   * A down-sampled view of the board for opponents. Produced at ~5–10 Hz by the
   * realtime layer — never the full 60 Hz board. The board encoding is left
   * open here (delta/RLE is a later optimization).
   */
  snapshot(): GameSnapshot
}

/** The minimal authoritative state broadcast to opponents. */
export interface GameSnapshot {
  userId: string
  score: number
  lines: number
  level: number
  over: boolean
}

/**
 * Compile-time proof that every protocol action is a valid engine action and
 * vice-versa. If either union changes without the other, this stops type-checking.
 */
export type _ActionsAligned = [GameAction] extends [EngineAction]
  ? [EngineAction] extends [GameAction]
    ? true
    : never
  : never
export const assertActionsAligned: _ActionsAligned = true
