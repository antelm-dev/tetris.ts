import type { Direction } from '../types'
import type { PieceName } from '../const'

export default class Piece {
  public name: PieceName
  public shape: number[][]
  public x = 0
  public y = 0

  public constructor(name: PieceName, shape: readonly (readonly number[])[]) {
    this.shape = shape.map((row) => [...row])
    this.name = name
  }

  public clone(): Piece {
    const piece = new Piece(this.name, this.shape)
    piece.x = this.x
    piece.y = this.y
    return piece
  }

  public rotate(dir: 'left' | 'right' = 'right'): void {
    const transposed = this.shape[0].map((_, i) => this.shape.map((row) => row[i]))
    if (dir === 'right') this.shape = transposed.map((row) => row.toReversed())
    else this.shape = transposed.toReversed()
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
