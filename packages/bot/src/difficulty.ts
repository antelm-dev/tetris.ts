import type { RandomFn } from '@tetris/engine'
import { HeuristicStrategy } from './strategy'
import type { BotDifficulty, BotStrategy } from './types'

export interface DifficultyConfig {
  /** Milliseconds between each single-action step the bot takes. */
  actionDelayMs: number
  /** Evaluate the current piece plus one preview piece. */
  lookahead: boolean
  /** 0–1 chance of deliberately picking a worse-than-best placement. */
  noise: number
  /** Consider swapping to hold when it materially improves the result. */
  considerHold: boolean
}

export const DIFFICULTY_CONFIG: Record<BotDifficulty, DifficultyConfig> = {
  easy: { actionDelayMs: 260, lookahead: false, noise: 0.35, considerHold: false },
  normal: { actionDelayMs: 140, lookahead: false, noise: 0.08, considerHold: false },
  hard: { actionDelayMs: 60, lookahead: true, noise: 0, considerHold: true }
}

export function createBotStrategy(difficulty: BotDifficulty, random: RandomFn): BotStrategy {
  const config = DIFFICULTY_CONFIG[difficulty]
  return new HeuristicStrategy({ ...config, random })
}
