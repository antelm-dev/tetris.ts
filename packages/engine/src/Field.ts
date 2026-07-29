import type { Direction, Slot } from './types'
import type Piece from './Piece'
import type { RandomFn } from './Game'

export type PlaceResult = {
  cleared: number
  /** True when any occupied cell of the locked piece sits above the visible well. */
  lockOut: boolean
}

export default class Field {
  private _slots: Slot[][]

  /**
   * Row indices completed by the most recent `placePiece` call, captured
   * *before* they collapse. Purely informational — the renderer reads it to
   * position line-clear effects.
   */
  public lastCleared: number[] = []

  public get slots(): Slot[][] {
    return this._slots
  }

  constructor(options: { width: number; height: number }) {
    this._slots = Array.from({ length: options.height }, () => new Array<Slot>(options.width).fill(0))
  }

  public clearRow(index: number): void {
    this._slots.splice(index, 1)
    this._slots.unshift(new Array<Slot>(this._slots[0].length).fill(0))
  }

  private getNextMove(action: Direction) {
    const x = action === 'left' ? -1 : Number(action === 'right')
    return { x, y: Number(action === 'down') }
  }

  /**
   * True if the cell is filled *or* outside the well — walls and the floor
   * count as solid. This is the primitive the T-spin corner rule reads.
   */
  public isSolid(x: number, y: number): boolean {
    if (x < 0 || x >= this._slots[0].length || y >= this._slots.length) return true
    if (y < 0) return false // open sky above the well
    return !!this._slots[y][x]
  }

  public overlaps(piece: Piece): boolean {
    return piece.shape.some((row, dy) =>
      row.some((cell, dx) => {
        if (!cell) return false
        const y = piece.y + dy
        const x = piece.x + dx
        return y >= 0 && !!this._slots[y]?.[x]
      })
    )
  }

  /**
   * True if `piece`, at its current position and shape, overlaps a wall, the
   * floor, or a filled cell. Unlike {@link overlaps} this also enforces the
   * board bounds, so it can validate arbitrary kick-tested placements.
   */
  public collides(piece: Piece): boolean {
    return piece.shape.some((row, dy) =>
      row.some((cell, dx) => {
        if (!cell) return false
        const x = piece.x + dx
        const y = piece.y + dy
        return x < 0 || x >= this._slots[0].length || y >= this._slots.length || (y >= 0 && !!this._slots[y][x])
      })
    )
  }

  /**
   * True if `piece` cannot shift by a single cell in any of the four cardinal
   * directions. This is the generalized "immobile" spin test: a piece that
   * locks while immobile immediately after a rotation counts as a spin
   * (T-spin, L-spin, S-spin, …).
   */
  public isImmobile(piece: Piece): boolean {
    const dirs: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0]
    ]
    return dirs.every(([dx, dy]) => {
      const probe = piece.clone()
      probe.x += dx
      probe.y += dy
      return this.collides(probe)
    })
  }

  /** True if `piece` cannot take one step in `action`. Rotation is not a step —
   *  it kicks, so it goes through {@link collides} on each candidate instead. */
  public checkCollision(piece: Piece, action: Direction): boolean {
    const move = this.getNextMove(action)
    const probe = piece.clone()
    probe.x += move.x
    probe.y += move.y
    return this.collides(probe)
  }

  /**
   * Write `piece` into the well and collapse any completed rows.
   *
   * Cells with a negative row are a lock-out: they are never written (indexing
   * above the board would throw), and {@link PlaceResult.lockOut} is set so the
   * game can end cleanly. On-board cells still place and clear as usual.
   */
  public placePiece(piece: Piece): PlaceResult {
    const indexes = new Set<number>()
    let lockOut = false
    piece.shape.forEach((row, i) => {
      const k = piece.y + i
      row.forEach((cell, j) => {
        if (!cell) return
        if (k < 0) {
          lockOut = true
          return
        }
        this._slots[k][piece.x + j] = piece.name
        indexes.add(k)
      })
    })
    // Clear top-to-bottom (ascending): clearRow unshifts a new row at the top,
    // which shifts every row *above* the cleared one down by one. Clearing a
    // smaller index leaves larger indices valid, so multi-line clears work.
    const fullRows = [...indexes].filter((i) => this._slots[i].every((v) => v)).sort((a, b) => a - b)
    this.lastCleared = fullRows
    for (const i of fullRows) this.clearRow(i)
    return { cleared: fullRows.length, lockOut }
  }

  /** True when every cell in the well is empty. */
  public isEmpty(): boolean {
    return this._slots.every((row) => row.every((cell) => cell === 0))
  }

  public reset(): void {
    this._slots = this._slots.map((row) => row.map((): Slot => 0))
  }

  /** An independent deep copy — mutating the clone never touches this field, or vice versa. */
  public clone(): Field {
    const field = new Field({ width: this._slots[0].length, height: this._slots.length })
    field._slots = this._slots.map((row) => [...row])
    return field
  }

  /**
   * Push garbage rows in from the bottom with explicit hole columns, shifting
   * every existing row up to make room. Returns `true` if any row shifted off
   * the top was non-empty — a garbage-induced top-out.
   *
   * Authoritative multiplayer uses this so a delivery can be reproduced from
   * the wire payload without consulting the recipient's RNG.
   */
  public addGarbageRows(holes: readonly number[]): boolean {
    const width = this._slots[0].length
    let toppedOut = false
    for (const rawHole of holes) {
      if (this._slots[0].some((cell) => cell !== 0)) toppedOut = true
      this._slots.shift()
      const hole = ((rawHole % width) + width) % width
      const row = new Array<Slot>(width).fill('GARBAGE')
      row[hole] = 0
      this._slots.push(row)
    }
    return toppedOut
  }

  /**
   * Push `count` garbage rows in from the bottom, each solid except for one
   * random hole. Hole placement is driven by the injected {@link RandomFn}.
   */
  public addGarbage(count: number, random: RandomFn): boolean {
    const width = this._slots[0].length
    const holes = Array.from({ length: count }, () => Math.floor(random() * width))
    return this.addGarbageRows(holes)
  }
}
