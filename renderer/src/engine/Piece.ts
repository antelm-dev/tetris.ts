import type { Direction } from './types'
import type { Orientation, PieceName } from './const'

export default class Piece {
  public name: PieceName
  /**
   * The piece inside its square bounding box (see `PIECES_SHAPES`). Square is a
   * requirement, not a convenience: {@link rotate} turns the contents about the
   * centre of this box, so a box that changed shape per turn would drag the
   * piece around the board with it.
   */
  public shape: number[][]
  /** Column of the box's left edge — *not* of the piece's leftmost cell. */
  public x = 0
  /** Row of the box's top edge — *not* of the piece's topmost cell. */
  public y = 0
  /** Rotation state 0–3 (0 = spawn), advanced by {@link rotate}. */
  public orientation: Orientation = 0

  public constructor(name: PieceName, shape: readonly (readonly number[])[]) {
    this.shape = shape.map((row) => [...row])
    this.name = name
  }

  public clone(): Piece {
    const piece = new Piece(this.name, this.shape)
    piece.x = this.x
    piece.y = this.y
    piece.orientation = this.orientation
    return piece
  }

  /**
   * Turn a quarter-turn in place. Transpose, then reverse — rows for a
   * clockwise turn, the row order for a counter-clockwise one. On the square
   * box this is a true rotation about the box centre, and it is its own
   * inverse: rotating right then left is exactly a no-op.
   */
  public rotate(dir: 'left' | 'right' = 'right'): void {
    const transposed = this.shape[0].map((_, i) => this.shape.map((row) => row[i]))
    if (dir === 'right') this.shape = transposed.map((row) => row.toReversed())
    else this.shape = transposed.toReversed()
    this.orientation = ((this.orientation + (dir === 'right' ? 1 : 3)) % 4) as Orientation
  }

  /** The filled cells, in field coordinates. */
  public cells(): [number, number][] {
    const out: [number, number][] = []
    this.shape.forEach((row, dy) =>
      row.forEach((cell, dx) => {
        if (cell) out.push([this.x + dx, this.y + dy])
      })
    )
    return out
  }

  /** The lowest (largest-y) row this piece occupies — the row it rests on. */
  public get bottom(): number {
    return Math.max(...this.cells().map(([, y]) => y))
  }

  public move(dir: Direction): void {
    switch (dir) {
      case 'left':
        this.x--
        break
      case 'right':
        this.x++
        break
      case 'down':
        this.y++
        break
    }
  }
}
