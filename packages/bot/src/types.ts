import type { Game } from '@tetris/engine'
import type { Orientation } from '@tetris/engine'

/** How aggressively a `BotController` searches and how often it acts. */
export type BotDifficulty = 'easy' | 'normal' | 'hard'

/** A placement the bot has committed to executing. */
export interface BotMove {
  rotation: Orientation
  x: number
  /** Swap the active piece for hold before seeking `rotation`/`x`, if true. */
  useHold?: boolean
}

/**
 * Decides what a bot should do with the current `activePiece`. Implementations
 * must read `game` only — never mutate it (see `bot/placements.ts`).
 */
export interface BotStrategy {
  chooseMove(game: Game): BotMove | undefined
}
