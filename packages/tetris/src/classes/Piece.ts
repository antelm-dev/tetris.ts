import type { Direction } from '../types'
/**
 * Classe représentant une pièce de Tetris
 */
export default class Piece {
  /**
   * Nom de la pièce
   */
  public name: string
  /**
   * Forme de la pièce
   */
  public shape: number[][]
  /**
   * Position de la pièce
   */
  public x: number
  /**
   * Position de la pièce
   */
  public y: number

  /**
   * Crée une pièce de Tetris
   * @param name Nom de la pièce
   * @param shape Forme de la pièce
   */
  public constructor(name: string, shape: number[][]) {
    this.shape = shape
    this.name = name
    this.x = 0
    this.y = 0
  }

  /**
   * Effectue une rotation de la pièce
   * @param dir La direction de la rotation
   */
  public rotate(dir: Omit<Direction, 'down'> = 'right'): void {
    const transposed = this.shape[0].map((_, i) => this.shape.map((row) => row[i]))
    if (dir === 'right') this.shape = transposed.map((row) => row.toReversed())
    else this.shape = transposed.toReversed()
  }
  /**
   * Déplace la pièce
   * @param dir La direction du mouvement
   */
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
      default:
        throw new Error('Invalid direction')
    }
  }
}
