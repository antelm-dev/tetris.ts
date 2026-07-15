import type { Game } from '../engine'
import type { BotMove, BotStrategy } from './types'

/** Consecutive no-progress ticks before a target is abandoned and replanned. */
const MAX_STUCK_TICKS = 3

/**
 * Drives a bot's `Game` purely through `game.action(...)` calls, one action
 * per `actionDelayMs` — it never sets `activePiece`/`field` directly. Each
 * step re-reads the live piece against the current target (rotation, x) and
 * issues whichever single action closes the gap furthest; if the piece's
 * orientation/x stop changing across ticks — a blocked move, or a kick that
 * left the plan unreachable — the target is dropped and the strategy is
 * asked to replan from the actual live state on the next tick.
 */
export class BotController {
  private target?: BotMove
  private holdIssued = false
  private timer = 0
  private stuckTicks = 0
  private lastSignature = ''

  public constructor(
    private readonly game: Game,
    private readonly strategy: BotStrategy,
    private readonly actionDelayMs: number
  ) {}

  /** A new piece became active — any stale target no longer applies. */
  public onSpawn(): void {
    this.resetTarget()
  }

  /** The active piece just locked — mirrors {@link onSpawn} for safety. */
  public onLock(): void {
    this.resetTarget()
  }

  private resetTarget(): void {
    this.target = undefined
    this.holdIssued = false
    this.stuckTicks = 0
    this.lastSignature = ''
  }

  public update(dt: number): void {
    if (!this.game.activePiece || this.game.gameOver || this.game.isPaused) return
    this.timer += dt * 1000
    if (this.timer < this.actionDelayMs) return
    this.timer = 0
    this.step()
  }

  private step(): void {
    if (!this.target) {
      this.target = this.strategy.chooseMove(this.game)
      this.holdIssued = false
      this.stuckTicks = 0
      this.lastSignature = ''
      if (!this.target) return
    }

    if (this.target.useHold && !this.holdIssued) {
      this.game.action('hold')
      this.holdIssued = true
      return
    }

    const piece = this.game.activePiece
    if (!piece) return

    const signature = `${piece.orientation}:${piece.x}`
    if (signature === this.lastSignature) {
      this.stuckTicks++
      if (this.stuckTicks > MAX_STUCK_TICKS) {
        this.target = undefined
        return
      }
    } else {
      this.stuckTicks = 0
      this.lastSignature = signature
    }

    if (piece.orientation !== this.target.rotation) {
      this.game.action(rotationTowards(piece.orientation, this.target.rotation))
      return
    }
    if (piece.x !== this.target.x) {
      this.game.action(piece.x < this.target.x ? 'right' : 'left')
      return
    }
    this.game.action('push')
    this.target = undefined
  }
}

/** The single quarter-turn action that shortens the gap from `from` to `to`. */
function rotationTowards(from: number, to: number): 'rotate-left' | 'rotate-right' {
  const diff = (to - from + 4) % 4
  return diff === 3 ? 'rotate-left' : 'rotate-right'
}
