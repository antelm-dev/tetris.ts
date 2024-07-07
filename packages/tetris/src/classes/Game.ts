import Field from './Field'
import Piece from './Piece'
import { PIECES_SHAPES } from '../const'
import type { Direction } from '../types'

/**
 * Classe représentant une partie de Tetris
 */
export default class Game {
  /**
   * Le score de la partie
   */
  public score = 0
  /**
   * Le nombre de lignes consécutives
   */
  public streak = 0
  /**
   * Les pièces à venir
   */
  public nextPieces: Piece[] = []
  /**
   * La pièce sauvegardée
   */
  public holdPiece?: Piece

  /**
   * Le terrain de jeu
   */
  public field: Field

  /**
   * Indique si le jeu est en pause
   */
  private paused: boolean = false

  /**
   * La pièce active
   */
  public activePiece?: Piece

  /**
   * @param options Les options de la partie
   */
  constructor(options: { width: number; height: number }) {
    this.field = new Field(options)
    this.nextPieces = Array.from({ length: 4 }, () => Game.randomPiece)
  }

  /**
   * Met à jour la partie
   */
  public update(): void {
    if (this.paused) return

    if (!this.activePiece) {
      this.addNextPiece()
    } else {
      const land = this.field.checkCollision(this.activePiece, 'down')
      if (land) this.push(this.activePiece)
      else this.activePiece.move('down')
    }

    if (this.field.slots[0].some((v) => v)) this.gameOver()
  }

  /**
   * @param piece La pièce à ajouter
   */
  private addPiece(piece: Piece): void {
    const center = this.field.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    this.activePiece.shape.map((row) => {
      row.map((cell) => (cell ? this.activePiece!.name : 0))
    })
  }

  /**
   *
   */
  private addNextPiece(): void {
    this.addPiece(this.nextPieces.pop()!)
    this.nextPieces.unshift(Game.randomPiece)
  }
  /**
   * @returns Une pièce aléatoire
   */
  private static get randomPiece(): Piece {
    const keys = Object.keys(PIECES_SHAPES)
    const random = Math.floor(Math.random() * keys.length)
    const key = keys[random]
    return new Piece(key as keyof typeof PIECES_SHAPES, PIECES_SHAPES[key])
  }

  /**
   * @param name L'action à effectuer
   */
  public action(name: Direction | 'rotate' | 'hold' | 'push' | 'pause'): void {
    if (!this.activePiece) return
    if (name === 'push') this.push(this.activePiece)
    else if (name === 'pause') this.pause()
    else {
      const colide = this.field.checkCollision(this.activePiece, name)
      if (colide) return
      if (name === 'hold') this.hold()
      if (name === 'rotate') this.activePiece.rotate()
      if (['down', 'left', 'right'].includes(name)) {
        this.activePiece.move(name as Direction)
      }
    }
  }

  /**
   * Pousse la pièce active vers le bas
   */
  public push(piece: Piece): void {
    while (!this.field.checkCollision(piece, 'down')) piece.move('down')
    this.field.placePiece(piece)
    this.activePiece = undefined
  }

  /**
   * Réinitialise la partie
   */
  private gameOver(): void {
    this.field.reset()
  }

  /**
   * Met en pause ou reprend la partie
   */
  private pause(): void {
    this.paused = !this.paused
  }

  public hold(): void {
    if (!this.activePiece) return
    const piece = new Piece(this.activePiece.name, this.activePiece.shape)
    this.activePiece = undefined
    if (this.holdPiece) this.addPiece(this.holdPiece)
    else this.addNextPiece()
    this.holdPiece = piece
  }
}
