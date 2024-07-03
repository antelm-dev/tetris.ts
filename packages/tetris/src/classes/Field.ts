import { Direction } from '../types'
import type Piece from './Piece'

/**
 * Classe représentant le terrain de jeu de Tetris
 */
export default class Field {
  /**
   * Les cases du terrain de jeu
   */
  public slots: (number | string)[][]

  /**
   * @param options Les options du terrain de jeu
   */
  constructor(options: { width: number; height: number }) {
    this.slots = Array.from({ length: options.height }, () => {
      return Array.from({ length: options.width }, () => 0)
    })
  }

  /**
   * @param index L'index de la ligne à vider
   */
  public clearRow(index: number): void {
    this.slots.splice(index, 1)
    this.slots.unshift(Array.from({ length: this.slots[0].length }, () => 0))
  }

  /**
   * Vérifie si une action provoque une collision
   * @param action L'action à vérifier
   */
  public checkCollision(piece: Piece, action: Direction | 'rotate'): boolean {
    const localPiece: Piece = Object.create(piece)

    const move = {
      x: action === 'left' ? -1 : action === 'right' ? 1 : 0,
      y: action === 'down' ? 1 : 0
    }

    if (action === 'rotate') localPiece.rotate()

    return localPiece.shape.some((row, dy) =>
      row.some((cell, dx) => {
        if (!cell) return false
        const newY = localPiece.y + dy + move.y
        const newX = localPiece.x + dx + move.x
        return (
          newX <= -1 ||
          newX >= this.slots[0].length ||
          newY >= this.slots.length ||
          (newY >= 0 && this.slots[newY][newX])
        )
      })
    )
  }

  /**
   * Place la pièce active sur le terrain de jeu
   */
  public placePiece(piece: Piece): void {
    piece.shape.forEach((row, i) => {
      const k = piece.y + i
      row.forEach((cell, j) => {
        if (cell) this.slots[k][piece.x + j] = piece.name
      })
      if (this.slots[k]?.every((v) => v)) this.clearRow(k)
    })
  }

  public reset(): void {
    this.slots = this.slots.map((row) => row.map(() => 0))
  }
}
