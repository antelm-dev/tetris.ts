import { Direction, Rotate } from '../types'
import type Piece from './Piece'

/**
 * Classe représentant le terrain de jeu de Tetris
 */
export default class Field {
  /**
   * Les cases du terrain de jeu
   */
  private _slots: (number | string)[][]
  public get slots(): (number | string)[][] {
    return this._slots
  }
  /**
   * @param options Les options du terrain de jeu
   */
  constructor(options: { width: number; height: number }) {
    this._slots = Array.from({ length: options.height }, () => {
      return Array.from({ length: options.width }, () => 0)
    })
  }

  /**
   * @param index L'index de la ligne à vider
   */
  public clearRow(index: number): void {
    this._slots.splice(index, 1)
    this._slots.unshift(new Array(this._slots[0].length).fill(0))
  }

  private getNextMove(action: string): { x: number; y: number } {
    return {
      x:
        {
          left: -1,
          right: 1
        }[action] ?? 0,
      y: action === 'down' ? 1 : 0
    }
  }

  /**
   * Vérifie si une action provoque une collision
   * @param action L'action à vérifier
   */
  public checkCollision(piece: Piece, action: Direction | Rotate): boolean {
    const localPiece: Piece = Object.create(piece)

    const move = this.getNextMove(action)

    if (action?.startsWith('rotate')) {
      localPiece.rotate(action.split('-')[1])
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
          (newY >= 0 && this._slots[newY][newX])
        )
      })
    )
  }

  /**
   * Place la pièce active sur le terrain de jeu
   */
  public placePiece(piece: Piece): void {
    const indexes: Set<number> = new Set()
    piece.shape.forEach((row, i) => {
      const k = piece.y + i
      row.forEach((cell, j) => {
        if (cell) {
          this._slots[k][piece.x + j] = piece.name
          indexes.add(k)
        }
      })
    })
    for (const i of indexes) {
      if (this._slots[i].every((v) => v)) this.clearRow(i)
    }
  }

  public reset(): void {
    this._slots = this._slots.map((row) => row.map(() => 0))
  }
}
