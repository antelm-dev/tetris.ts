import type { Game } from '@tetris/engine'
import type { GameAction } from '@tetris/protocol'
import type { AuthoritativeGameSession, GameSnapshot } from './interfaces/authoritative-session.interface'

/**
 * The exact slice of the engine's `Game` this session drives. Typed as a
 * `Pick` of the real class so it stays in lock-step with the engine without
 * importing it at runtime — the concrete `Game` instance is injected in
 * (constructed with a seeded RNG for determinism). Tests wire the real engine.
 */
export type EngineGame = Pick<Game, 'action' | 'tick' | 'score' | 'lines' | 'level' | 'gameOver'>

/**
 * Reference implementation of {@link AuthoritativeGameSession} over the shared
 * engine. It adds only the server's concerns — input sequencing and a compact
 * snapshot — and delegates all game rules to the engine, so the rules are never
 * duplicated. The engine instance is passed in rather than constructed here so
 * this class carries no runtime dependency on `@tetris/engine` (which ships as
 * source): the production wiring that builds/loads the engine is the next step.
 */
export class EngineGameSession implements AuthoritativeGameSession {
  /** Highest client sequence applied so far; guards against stale/duplicate inputs. */
  private lastSeq = -1

  constructor(
    public readonly userId: string,
    private readonly game: EngineGame
  ) {}

  get isOver(): boolean {
    return this.game.gameOver
  }

  applyAction(action: GameAction, seq: number): void {
    if (seq <= this.lastSeq) return
    this.lastSeq = seq
    if (this.game.gameOver) return
    // `GameAction` is provably a subset of the engine's `Action` union
    // (see assertActionsAligned), so this needs no cast.
    this.game.action(action)
  }

  advance(dtMs: number): void {
    this.game.tick(dtMs)
  }

  snapshot(): GameSnapshot {
    return {
      userId: this.userId,
      score: this.game.score,
      lines: this.game.lines,
      level: this.game.level,
      over: this.game.gameOver
    }
  }
}
