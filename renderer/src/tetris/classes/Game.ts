import Field from './Field'
import Piece from './Piece'
import { PIECES_SHAPES } from '../const'
import type { PieceName } from '../const'
import type { Action, Direction } from '../types'

export default class Game {
  public score = 0
  public streak = 0
  public nextPieces: Piece[] = []
  public holdPiece?: Piece
  private canHold = true
  private _gameOver = false
  private paused = false
  public activePiece?: Piece
  public field: Field

  public get gameOver() {
    return this._gameOver
  }

  public get isPaused() {
    return this.paused
  }

  constructor(options: { width: number; height: number }) {
    this.field = new Field(options)
    this.initQueue()
  }

  private initQueue(): void {
    this.nextPieces = Array.from({ length: 4 }, () => Game.randomPiece)
  }

  public update(): void {
    if (this.paused || this._gameOver) return

    if (!this.activePiece) {
      this.addNextPiece()
    } else {
      const land = this.field.checkCollision(this.activePiece, 'down')
      if (land) this.push()
      else this.activePiece.move('down')
    }
  }

  private addPiece(piece: Piece): void {
    const center = this.field.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    if (this.field.overlaps(this.activePiece)) this.setGameOver()
  }

  private addNextPiece(): void {
    this.addPiece(this.nextPieces.pop()!)
    this.nextPieces.unshift(Game.randomPiece)
  }

  private static get randomPiece(): Piece {
    const keys = Object.keys(PIECES_SHAPES) as PieceName[]
    const key = keys[Math.floor(Math.random() * keys.length)]
    return new Piece(key, PIECES_SHAPES[key])
  }

  public action(name: Action): void {
    if (this._gameOver && name === 'push') {
      this.start()
      return
    }
    if (this._gameOver || !this.activePiece) return
    if (name === 'hold') this.hold()
    else if (name === 'push') this.push()
    else if (name === 'pause') this.pause()
    else {
      if (this.field.checkCollision(this.activePiece, name)) return
      if (name.startsWith('rotate'))
        this.activePiece.rotate(name.split('-')[1] as 'left' | 'right')
      else this.activePiece.move(name as Direction)
    }
  }

  public push(): void {
    if (!this.activePiece) throw new Error('Active piece undefined')
    while (!this.field.checkCollision(this.activePiece, 'down')) this.activePiece.move('down')
    this.applyScore(this.field.placePiece(this.activePiece))
    this.activePiece = undefined
    this.canHold = true
  }

  private applyScore(lines: number): void {
    if (lines === 0) {
      this.streak = 0
      return
    }
    this.streak++
    const points = [0, 100, 300, 500, 800]
    this.score += (points[lines] ?? 800) * this.streak
  }

  private setGameOver(): void {
    this._gameOver = true
    this.activePiece = undefined
  }

  private start(): void {
    this.field.reset()
    this._gameOver = false
    this.score = 0
    this.streak = 0
    this.holdPiece = undefined
    this.canHold = true
    this.initQueue()
    this.addNextPiece()
  }

  private pause(): void {
    this.paused = !this.paused
  }

  public hold(): void {
    if (!this.canHold || !this.activePiece) return
    const piece = new Piece(this.activePiece.name, PIECES_SHAPES[this.activePiece.name])
    this.activePiece = undefined
    if (this.holdPiece) this.addPiece(this.holdPiece)
    else this.addNextPiece()
    this.holdPiece = piece
    this.canHold = false
  }
}
