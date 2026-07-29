import type P5 from 'p5'
import { CELL, COLS, cellToWorld } from '../core/geometry'
import type { Cell } from './cells'

/**
 * The white blow-out that fires when a piece locks and when a row clears. Both
 * are pools of short-lived entries with a `t` that decays 1 → 0 and drives the
 * fade, kept together here because they're the same idea at two scales — the
 * cells of a piece, or a full row of the well.
 */
export class Flashes {
  private readonly locks: { cells: Cell[]; t: number }[] = []
  private readonly clears: { row: number; t: number }[] = []

  /** Flash the cells a piece just locked into. */
  public lock(cells: Cell[]): void {
    this.locks.push({ cells, t: 1 })
  }

  /** Flash a completed row, at its pre-collapse index. */
  public clear(row: number): void {
    this.clears.push({ row, t: 1 })
  }

  public reset(): void {
    this.locks.length = 0
    this.clears.length = 0
  }

  public update(dt: number): void {
    decay(this.locks, dt * 5.5)
    decay(this.clears, dt * 3)
  }

  public draw(p: P5): void {
    if (this.locks.length === 0 && this.clears.length === 0) return
    p.push()
    p.noStroke()
    p.blendMode(p.ADD)
    for (const lf of this.locks) {
      for (const cell of lf.cells) {
        const { x, y } = cellToWorld(cell.col, cell.row)
        p.push()
        p.translate(x, y, 4)
        p.fill(255, 255, 255, 200 * lf.t)
        p.box(CELL * 0.92, CELL * 0.92, CELL * 0.5)
        p.pop()
      }
    }
    for (const cf of this.clears) {
      const { y } = cellToWorld(0, cf.row)
      p.push()
      p.translate(0, y, 6)
      p.fill(255, 255, 255, 230 * cf.t)
      p.box(COLS * CELL * (0.6 + cf.t * 0.5), CELL * (0.4 + cf.t * 0.8), CELL * 0.3)
      p.pop()
    }
    p.blendMode(p.BLEND)
    p.pop()
  }
}

/** Age every entry by `step` and drop the dead ones, in place. */
function decay(pool: { t: number }[], step: number): void {
  for (let i = pool.length - 1; i >= 0; i--) {
    pool[i].t -= step
    if (pool[i].t <= 0) pool.splice(i, 1)
  }
}
