import type { GameAction } from '@tetris/protocol'
import type { Action as EngineAction, GameProjection, GarbageRow } from '@tetris/engine'
import type { AuthoritativeGameSession, GameSnapshot } from './interfaces/authoritative-session.interface'

/**
 * Slice of `@tetris/engine` `Game` the session drives. Prefer {@link advance}
 * (milliseconds, gravity + lock) over the legacy seconds-based `tick`.
 */
export type EngineGame = Pick<
  {
    action(name: EngineAction): void
    advance(dtMs: number): void
    project(): GameProjection
    receiveGarbage(countOrRows: number | readonly GarbageRow[]): void
    score: number
    lines: number
    level: number
    gameOver: boolean
  },
  'action' | 'advance' | 'project' | 'receiveGarbage' | 'score' | 'lines' | 'level' | 'gameOver'
>

/**
 * Authoritative session over the shared engine: input sequencing plus compact
 * projections. Engine construction stays with the match owner.
 */
export class EngineGameSession implements AuthoritativeGameSession {
  private lastSeq = -1

  constructor(
    public readonly userId: string,
    private readonly game: EngineGame
  ) {}

  get isOver(): boolean {
    return this.game.gameOver
  }

  get score(): number {
    return this.game.score
  }

  get lines(): number {
    return this.game.lines
  }

  /**
   * Apply a sequenced input. Returns `true` only when the action mutated (or
   * was accepted as a live input). Stale/duplicate/post-over/`pause` inputs
   * return `false` and leave the simulation unchanged.
   */
  applyAction(action: GameAction, seq: number): boolean {
    if (seq <= this.lastSeq) return false
    this.lastSeq = seq
    if (this.game.gameOver) return false
    // Versus matches are continuous — a client pause must not freeze authority.
    if (action === 'pause') return false
    this.game.action(action)
    return true
  }

  advance(dtMs: number): void {
    this.game.advance(dtMs)
  }

  project(): GameProjection {
    return this.game.project()
  }

  receiveGarbage(rows: readonly GarbageRow[]): void {
    this.game.receiveGarbage(rows)
  }

  snapshot(): GameSnapshot {
    const projection = this.game.project()
    return {
      userId: this.userId,
      score: projection.score,
      lines: projection.lines,
      level: projection.level,
      over: projection.gameOver,
      board: projection.board,
      activePiece: projection.activePiece
    }
  }
}
