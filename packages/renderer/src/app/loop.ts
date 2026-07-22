import { easeK } from '../core/ease'
import type { Game, Piece } from '@tetris/engine'

/**
 * The two clocks the sketch runs between the engine and the screen.
 *
 * The engine only ever moves a piece a whole cell at a time, and only when it's
 * told to. {@link Gravity} decides when to tell it, on a real-time clock;
 * {@link PieceMotion} then hides those discrete steps behind an interpolated
 * position, so the piece *slides* rather than jumping a cell at a time.
 */

/** Milliseconds a piece takes to fall one cell at a given level. */
export function gravityInterval(level: number): number {
  return Math.max(70, 800 * Math.pow(0.82, level - 1))
}

/** Ticks the engine on a wall-clock gravity interval, independent of frame rate. */
export class Gravity {
  private acc = 0

  public reset(): void {
    this.acc = 0
  }

  public update(dt: number, game: Game): void {
    const interval = gravityInterval(game.level)
    this.acc += dt * 1000
    // Capped, so a long stall (an alt-tab, a slow frame) can't dump a dozen
    // rows of accumulated gravity into a single frame.
    let steps = 0
    while (this.acc >= interval && steps < 6) {
      this.acc -= interval
      game.update()
      steps++
    }
  }
}

/**
 * Interpolated visual state for the active piece: its eased position, and the
 * scale pops that fire on spawn and rotation. Decoupled from the grid steps —
 * `x`/`y` chase the engine's integer cell rather than tracking it exactly.
 */
export class PieceMotion {
  public x = 0
  public y = 0
  private spawnPulse = 0
  private rotatePulse = 0
  private last?: Piece

  /** Scale multiplier for the active piece — 1 at rest, larger mid-pop. */
  public get pop(): number {
    return 1 + this.spawnPulse * 0.16 + this.rotatePulse * 0.12
  }

  public onSpawn(): void {
    this.spawnPulse = 1
  }

  /** `strength` above 1 is the extra flourish a spin gets over a plain rotation. */
  public onRotate(strength = 1): void {
    this.rotatePulse = strength
  }

  public update(dt: number, game: Game): void {
    const ap = game.activePiece
    if (ap) {
      // A brand-new piece snaps to its spawn cell; only movement is eased.
      if (ap !== this.last) {
        this.x = ap.x
        this.y = ap.y
        this.last = ap
      }
      this.x += (ap.x - this.x) * easeK(dt, 30)
      this.y += (ap.y - this.y) * easeK(dt, 26)
    } else {
      this.last = undefined
    }

    this.spawnPulse = Math.max(0, this.spawnPulse - dt * 4)
    this.rotatePulse = Math.max(0, this.rotatePulse - dt * 6)
  }
}
