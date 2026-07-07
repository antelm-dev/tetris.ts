import Field from './Field'
import Piece from './Piece'
import { PIECES_SHAPES } from '../const'
import type { PieceName } from '../const'
import type { Action, Direction, GameEvents } from '../types'

/**
 * Offsets (in cells) tried in order when a plain rotation collides — a
 * pragmatic "SRS-lite" wall-kick set. `y` is negative upward to match the
 * grid. The first offset that yields a valid placement wins; if none do, the
 * rotation is rejected. Nudging the piece into a tuck this way is what makes
 * spins physically possible.
 */
const WALL_KICKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
  [0, 1],
  [-2, 0],
  [2, 0],
  [0, -2]
]

export default class Game {
  public score = 0
  public streak = 0
  public lines = 0
  public level = 1
  public nextPieces: Piece[] = []
  public holdPiece?: Piece
  private canHold = true
  private _gameOver = false
  private paused = false
  /**
   * Whether the last successful action on the active piece was a rotation.
   * A lock only counts as a spin while this holds — any translation clears it.
   */
  private lastActionRotate = false
  public activePiece?: Piece
  public field: Field

  /** Renderer-supplied visual/audio hooks. Every callback is optional. */
  public events: GameEvents = {}

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
      else {
        this.activePiece.move('down')
        this.lastActionRotate = false
      }
    }
  }

  private addPiece(piece: Piece): void {
    const center = this.field.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    if (this.field.overlaps(this.activePiece)) this.setGameOver()
    else this.events.onSpawn?.(piece.name)
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
    // While paused the only accepted input is un-pausing.
    if (this.paused && name !== 'pause') return
    if (name === 'hold') this.hold()
    else if (name === 'push') this.push(true)
    else if (name === 'pause') this.pause()
    else if (name.startsWith('rotate')) {
      this.tryRotate(name.split('-')[1] as 'left' | 'right')
    } else {
      if (this.field.checkCollision(this.activePiece, name)) return
      this.activePiece.move(name as Direction)
      this.lastActionRotate = false
      if (name === 'left' || name === 'right') this.events.onMove?.(name)
    }
  }

  /**
   * Rotate the active piece, trying the {@link WALL_KICKS} offsets in order and
   * committing to the first that lands clear. A no-op if none fit. Tracks that
   * the last action was a rotation so a subsequent immobile lock reads as a spin.
   */
  private tryRotate(dir: 'left' | 'right'): void {
    if (!this.activePiece) return
    const rotated = this.activePiece.clone()
    rotated.rotate(dir)
    for (const [kx, ky] of WALL_KICKS) {
      const candidate = rotated.clone()
      candidate.x += kx
      candidate.y += ky
      if (!this.field.collides(candidate)) {
        this.activePiece = candidate
        this.lastActionRotate = true
        this.events.onRotate?.(kx !== 0 || ky !== 0)
        return
      }
    }
  }

  public push(hard = false): void {
    if (!this.activePiece) throw new Error('Active piece undefined')
    let dropped = false
    while (!this.field.checkCollision(this.activePiece, 'down')) {
      this.activePiece.move('down')
      dropped = true
    }
    // A spin only stands if the piece never travelled after its last rotation
    // and is wedged in place (immobile) at the moment it locks.
    const spin =
      this.lastActionRotate && !dropped && this.field.isImmobile(this.activePiece)
    const cleared = this.field.placePiece(this.activePiece)
    this.events.onLock?.(hard)
    this.applyScore(cleared, spin)
    if (spin) this.events.onSpin?.(this.activePiece.name, cleared)
    if (cleared > 0) this.events.onClear?.(this.field.lastCleared, cleared, this.level)
    this.activePiece = undefined
    this.canHold = true
    this.lastActionRotate = false
  }

  private applyScore(lines: number, spin = false): void {
    if (lines === 0) {
      // A spin with no clear still earns a small reward; combo resets as usual.
      if (spin) this.score += 100
      this.streak = 0
      return
    }
    this.streak++
    const points = spin ? [0, 800, 1200, 1600] : [0, 100, 300, 500, 800]
    this.score += (points[lines] ?? (points.at(-1) as number)) * this.streak
    this.lines += lines
    const level = Math.floor(this.lines / 10) + 1
    if (level > this.level) {
      this.level = level
      this.events.onLevelUp?.(level)
    }
  }

  private setGameOver(): void {
    this._gameOver = true
    this.activePiece = undefined
    this.events.onGameOver?.(this.score)
  }

  private start(): void {
    this.field.reset()
    this._gameOver = false
    this.score = 0
    this.streak = 0
    this.lines = 0
    this.level = 1
    this.holdPiece = undefined
    this.canHold = true
    this.initQueue()
    this.addNextPiece()
    this.events.onStart?.()
  }

  private pause(): void {
    this.paused = !this.paused
    this.events.onPause?.(this.paused)
  }

  public hold(): void {
    if (!this.canHold || !this.activePiece) return
    const piece = new Piece(this.activePiece.name, PIECES_SHAPES[this.activePiece.name])
    this.activePiece = undefined
    if (this.holdPiece) this.addPiece(this.holdPiece)
    else this.addNextPiece()
    this.holdPiece = piece
    this.canHold = false
    this.events.onHold?.()
  }
}
