import type { Direction, Rotate, Slot } from './types'
import type Piece from './Piece'

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
    this._slots = Array.from({ length: options.height }, () =>
      new Array<Slot>(options.width).fill(0)
    )
  }

  public clearRow(index: number): void {
    this._slots.splice(index, 1)
    this._slots.unshift(new Array<Slot>(this._slots[0].length).fill(0))
  }

  private getNextMove(action: Direction | Rotate) {
    return {
      x: action === 'left' ? -1 : action === 'right' ? 1 : 0,
      y: action === 'down' ? 1 : 0
    }
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
        return (
          x < 0 ||
          x >= this._slots[0].length ||
          y >= this._slots.length ||
          (y >= 0 && !!this._slots[y][x])
        )
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

  public checkCollision(piece: Piece, action: Direction | Rotate): boolean {
    const localPiece = piece.clone()
    const move = this.getNextMove(action)

    if (action.startsWith('rotate')) {
      localPiece.rotate(action.split('-')[1] as 'left' | 'right')
    }

    return localPiece.shape.some((row, dy) =>
      row.some((cell, dx) => {
        if (!cell) return false
        const newY = localPiece.y + dy + move.y
        const newX = localPiece.x + dx + move.x
        return (
          newX <= -1 ||
          newX >= this._slots[0].length ||
          newY >= this._slots.length ||
          (newY >= 0 && !!this._slots[newY][newX])
        )
      })
    )
  }

  public placePiece(piece: Piece): number {
    const indexes = new Set<number>()
    piece.shape.forEach((row, i) => {
      const k = piece.y + i
      row.forEach((cell, j) => {
        if (cell) {
          this._slots[k][piece.x + j] = piece.name
          indexes.add(k)
        }
      })
    })
    // Clear top-to-bottom (ascending): clearRow unshifts a new row at the top,
    // which shifts every row *above* the cleared one down by one. Clearing a
    // smaller index leaves larger indices valid, so multi-line clears work.
    const fullRows = [...indexes]
      .filter((i) => this._slots[i].every((v) => v))
      .sort((a, b) => a - b)
    this.lastCleared = fullRows
    for (const i of fullRows) this.clearRow(i)
    return fullRows.length
  }

  public reset(): void {
    this._slots = this._slots.map((row) => row.map((): Slot => 0))
  }
}
