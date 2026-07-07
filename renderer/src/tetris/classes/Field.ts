import type { Direction, Rotate, Slot } from '../types'
import type Piece from './Piece'

export default class Field {
  private _slots: Slot[][]

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
    for (const i of fullRows) this.clearRow(i)
    return fullRows.length
  }

  public reset(): void {
    this._slots = this._slots.map((row) => row.map((): Slot => 0))
  }
}
