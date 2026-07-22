import type { Field, Game, PieceName, RandomFn } from '@tetris/engine'
import { evaluateField } from './evaluate'
import { generatePlacements, simulatePlacement, type Placement } from './placements'
import type { BotMove, BotStrategy } from './types'

export interface HeuristicOptions {
  /** Evaluate the current piece plus one preview piece, 1-ply minimax. */
  lookahead: boolean
  /** Also consider swapping to the hold piece when it scores materially better. */
  considerHold: boolean
  /** 0–1 chance of deviating from the top-ranked placement. */
  noise: number
  random: RandomFn
}

interface Scored {
  placement: Placement
  score: number
}

/** How much better the held piece's best placement must score to be worth swapping to. */
const HOLD_IMPROVEMENT_THRESHOLD = 3

/**
 * Ranks every legal placement for the active piece by {@link evaluateField}
 * and, per `noise`, either takes the best or deliberately picks a worse one —
 * that's the whole difficulty knob (see `bot/difficulty.ts`).
 */
export class HeuristicStrategy implements BotStrategy {
  public constructor(private readonly opts: HeuristicOptions) {}

  public chooseMove(game: Game): BotMove | undefined {
    const piece = game.activePiece
    if (!piece) return undefined

    const best = this.bestForPiece(game, piece.name)
    if (!best) return undefined

    if (this.opts.considerHold) {
      // Whichever piece becomes active after `hold()`: the held piece if one is
      // stashed, otherwise the next piece in queue (Game.hold's own fallback).
      const holdName = game.holdPiece?.name ?? game.nextPieces.at(-1)?.name
      if (holdName && holdName !== piece.name) {
        const holdBest = this.bestForPiece(game, holdName)
        if (holdBest && holdBest.score > best.score + HOLD_IMPROVEMENT_THRESHOLD) {
          return { rotation: holdBest.placement.rotation, x: holdBest.placement.x, useHold: true }
        }
      }
    }

    return { rotation: best.placement.rotation, x: best.placement.x }
  }

  private bestForPiece(game: Game, name: PieceName): Scored | undefined {
    const ranked = this.rankPlacements(game, name)
    return ranked.length > 0 ? this.select(ranked) : undefined
  }

  private rankPlacements(game: Game, name: PieceName): Scored[] {
    const placements = generatePlacements(game.field, name)
    const scored = placements.map((placement) => ({
      placement,
      score: this.scorePlacement(game, name, placement)
    }))
    return scored.sort((a, b) => b.score - a.score)
  }

  /**
   * Score one placement: the resulting board's evaluation, plus — when
   * `lookahead` is on — the best the *next* queued piece can do against that
   * result (a simple 1-ply minimax). Runs entirely on cloned fields.
   */
  private scorePlacement(game: Game, name: PieceName, placement: Placement): number {
    const { field: resultField, result } = simulatePlacement(game.field, name, placement)
    const base = evaluateField(resultField, result.cleared)
    if (!this.opts.lookahead) return base

    const nextName = game.nextPieces.at(-1)?.name
    if (!nextName) return base
    const nextPlacements = generatePlacements(resultField, nextName)
    if (nextPlacements.length === 0) return base

    let bestNext = -Infinity
    for (const next of nextPlacements) {
      const { field: nextField, result: nextResult } = simulatePlacement(resultField, nextName, next)
      bestNext = Math.max(bestNext, evaluateField(nextField, nextResult.cleared))
    }
    return base + bestNext
  }

  /** Take the top-ranked placement, or — per `noise` — a worse one instead. */
  private select(ranked: Scored[]): Scored {
    if (ranked.length === 1 || this.opts.noise <= 0) return ranked[0]
    if (this.opts.random() >= this.opts.noise) return ranked[0]
    // Deviate into the lower half of the ranking — a plausible mistake, not
    // an arbitrary legal placement.
    const pool = ranked.slice(Math.ceil(ranked.length / 2))
    if (pool.length === 0) return ranked[0]
    return pool[Math.floor(this.opts.random() * pool.length)]
  }
}

/** Exposed for tests that want to score/rank a single field without a `Game`. */
export function bestPlacementFor(field: Field, name: PieceName): Placement | undefined {
  const placements = generatePlacements(field, name)
  let best: { placement: Placement; score: number } | undefined
  for (const placement of placements) {
    const { field: resultField, result } = simulatePlacement(field, name, placement)
    const score = evaluateField(resultField, result.cleared)
    if (!best || score > best.score) best = { placement, score }
  }
  return best?.placement
}
