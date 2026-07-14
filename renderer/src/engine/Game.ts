import Field from './Field'
import Piece from './Piece'
import { PIECES_SHAPES, kicksFor } from './const'
import type { PieceName } from './const'
import { clearScore, comboScore, hardDropScore, perfectClearScore, softDropScore, spinNoClearScore } from './scoring'
import type { Action, Direction, GameEvents } from './types'

/**
 * How long (ms) a grounded piece sits before it locks. The player's window to
 * slide or spin it into place at the last moment — without it, a piece locks
 * the instant gravity finds the floor and high levels become unplayable.
 */
const LOCK_DELAY = 500

/**
 * How many times a move or rotation may restart the lock timer before the
 * piece locks regardless. Caps the classic "spin it forever" stall while still
 * giving finesse room. Landing on a *lower* row refills the budget.
 */
const MAX_LOCK_RESETS = 15

export type RandomFn = () => number

export type GameOptions = {
  width: number
  height: number
  /** Unit interval RNG used by the 7-bag shuffle. Defaults to `Math.random`. */
  random?: RandomFn
}

export default class Game {
  public score = 0
  /**
   * Number of consecutive clears in the current run (the "combo" counter):
   * incremented on every clear, reset to 0 by any move that clears no lines.
   * The combo *bonus* kicks in from the second clear onward — see scoring.
   */
  public streak = 0
  /**
   * Length of the current back-to-back chain — the run of consecutive
   * "difficult" clears (a Tetris or any spin clear). Reset to 0 by any plain
   * 1–3 line clear; a no-clear move leaves it untouched. A chain of ≥ 2 earns
   * the back-to-back scoring bonus.
   */
  public b2b = 0
  public lines = 0
  public level = 1
  public nextPieces: Piece[] = []
  /**
   * The remaining names in the current 7-bag, drawn from the end and refilled
   * with a fresh shuffle once empty. See {@link nextPiece}.
   */
  private bag: PieceName[] = []
  public holdPiece?: Piece
  private canHold = true
  private _gameOver = false
  private paused = false
  /**
   * Whether the last successful action on the active piece was a rotation.
   * A lock only counts as a spin while this holds — any translation clears it.
   */
  private lastActionRotate = false
  /** Whether that rotation needed a kick — the "was it forced?" half of a spin. */
  private lastRotateKicked = false
  /** Milliseconds the piece has been grounded. See {@link LOCK_DELAY}. */
  private lockTimer = 0
  /** Lock-timer restarts spent on the current piece. See {@link MAX_LOCK_RESETS}. */
  private lockResets = 0
  /** Deepest row the piece has reached; falling past it refills the reset budget. */
  private lowestRow = -Infinity
  public activePiece?: Piece
  public field: Field
  private readonly random: RandomFn

  /** Renderer-supplied visual/audio hooks. Every callback is optional. */
  public events: GameEvents = {}

  public get gameOver() {
    return this._gameOver
  }

  public get isPaused() {
    return this.paused
  }

  constructor(options: GameOptions) {
    this.field = new Field(options)
    this.random = options.random ?? Math.random
    this.initQueue()
  }

  /**
   * Seed the preview queue. `nextPieces` is consumed from the end (see
   * {@link addNextPiece}), so the initial fill is reversed to keep the order
   * pieces are *dealt* in the order the bag produced them.
   */
  private initQueue(): void {
    this.bag = []
    this.nextPieces = Array.from({ length: 4 }, () => this.nextPiece()).reverse()
  }

  /**
   * One gravity step: spawn if the well is empty, otherwise fall a row. A
   * grounded piece is deliberately left alone — it is {@link tick}, on the
   * lock-delay clock, that decides when it stops being the player's problem.
   */
  public update(): void {
    if (this.paused || this._gameOver) return

    if (!this.activePiece) {
      this.addNextPiece()
      return
    }
    if (this.field.checkCollision(this.activePiece, 'down')) return
    this.activePiece.move('down')
    this.lastActionRotate = false
    this.onDescend()
  }

  /**
   * The lock-delay clock, advanced once per frame with `dt` in seconds.
   *
   * A grounded piece doesn't lock immediately: it gets {@link LOCK_DELAY}
   * milliseconds, and any successful move or rotation restarts that countdown
   * (up to {@link MAX_LOCK_RESETS} times). That grace period is what makes a
   * last-second slide or spin possible at all — at level 13 gravity is a 70 ms
   * tick, and without a lock delay the window to spin into a slot is a single
   * frame. Lifting off the floor again cancels the countdown entirely.
   */
  public tick(dt: number): void {
    if (this.paused || this._gameOver || !this.activePiece) return
    if (!this.field.checkCollision(this.activePiece, 'down')) {
      this.lockTimer = 0
      return
    }
    this.lockTimer += dt * 1000
    if (this.lockTimer >= LOCK_DELAY) this.push()
  }

  /** Restart the lock countdown after a successful move/rotate, budget allowing. */
  private resetLock(): void {
    if (!this.activePiece) return
    if (!this.field.checkCollision(this.activePiece, 'down')) return
    if (this.lockResets >= MAX_LOCK_RESETS) return
    this.lockResets++
    this.lockTimer = 0
  }

  /** Reaching a new deepest row is progress, so it refills the reset budget. */
  private onDescend(): void {
    if (!this.activePiece) return
    const bottom = this.activePiece.bottom
    if (bottom <= this.lowestRow) return
    this.lowestRow = bottom
    this.lockResets = 0
    this.lockTimer = 0
  }

  private addPiece(piece: Piece): void {
    const center = this.field.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    this.clearPieceState()
    if (this.field.overlaps(this.activePiece)) this.setGameOver()
    else this.events.onSpawn?.(piece.name)
  }

  private addNextPiece(): void {
    this.addPiece(this.nextPieces.pop()!)
    this.nextPieces.unshift(this.nextPiece())
  }

  /**
   * Deal the next tetromino from the 7-bag.
   *
   * Uniform random draws are what let a real game go twenty pieces without an I
   * — and hand out four in a row — so the guideline deals from a shuffled bag of
   * all seven instead: every piece appears exactly once per bag, which bounds the
   * worst-case drought at twelve pieces (last of one bag, first of the next) and
   * makes the queue something a player can actually plan against.
   */
  private nextPiece(): Piece {
    if (this.bag.length === 0) this.bag = this.shuffledBag()
    const name = this.bag.pop()!
    return new Piece(name, PIECES_SHAPES[name])
  }

  /** All seven names in a fresh Fisher–Yates shuffle driven by {@link random}. */
  private shuffledBag(): PieceName[] {
    const names = Object.keys(PIECES_SHAPES) as PieceName[]
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      ;[names[i], names[j]] = [names[j], names[i]]
    }
    return names
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
    else if (name === 'rotate-left' || name === 'rotate-right') {
      this.tryRotate(name === 'rotate-left' ? 'left' : 'right')
    } else this.moveActive(name)
  }

  /** A one-cell translation. A blocked move is a no-op — it is not an "action",
   *  so it neither restarts the lock timer nor clears the spin flag. */
  private moveActive(dir: Direction): void {
    if (!this.activePiece) return
    if (this.field.checkCollision(this.activePiece, dir)) return
    this.activePiece.move(dir)
    this.lastActionRotate = false
    this.resetLock()
    if (dir === 'down') {
      this.score += softDropScore(1)
      this.onDescend()
    } else this.events.onMove?.(dir)
  }

  /**
   * Rotate the active piece under SRS.
   *
   * The rotation itself is a turn about the piece's true centre (its square box
   * guarantees that). If the turned piece doesn't fit, the five offsets for this
   * exact from→to transition are tried in order and the first that fits wins;
   * if none do, the rotation is refused outright rather than fudged.
   *
   * Those offsets are the "seek an opening and force it" behaviour: they lean
   * the piece *into* the direction it is turning, which is how it climbs into a
   * slot it could never be dropped into. Because the table is keyed by the pair
   * of states, spinning clockwise into a right-hand slot gets its own offsets —
   * a single shared list, however clever, is what makes a game that spins one
   * way and not the other.
   */
  private tryRotate(dir: 'left' | 'right'): void {
    if (!this.activePiece) return
    const from = this.activePiece.orientation
    const rotated = this.activePiece.clone()
    rotated.rotate(dir)
    const table = kicksFor(rotated.name)
    const kicks = table?.[`${from}>${rotated.orientation}`] ?? [[0, 0] as const]

    for (const [kx, ky] of kicks) {
      const candidate = rotated.clone()
      candidate.x += kx
      candidate.y += ky
      if (this.field.collides(candidate)) continue
      this.activePiece = candidate
      this.lastActionRotate = true
      this.lastRotateKicked = kx !== 0 || ky !== 0
      this.resetLock()
      this.onDescend()
      this.events.onRotate?.(this.lastRotateKicked)
      return
    }
  }

  /**
   * Whether this lock counts as a spin. Two rules, either of which is enough:
   *
   * - *Immobile*: the piece can't shift a cell in any direction. The general
   *   rule that catches L-, S-, J- and Z-spins as well as T's.
   * - *Three corners*: for a T only — three of the four cells diagonally around
   *   its centre are solid. The guideline T-spin rule, and it credits the
   *   T-spins that the immobile test misses (a T-spin single often leaves the
   *   piece free to slide one way).
   *
   * Either way the rotation must have been the last thing that happened: travel
   * after a rotation means the piece fell into place rather than being spun in.
   */
  private isSpin(piece: Piece): boolean {
    if (!this.lastActionRotate) return false
    if (this.field.isImmobile(piece)) return true
    if (piece.name !== 'T') return false
    // The T's centre is the middle of its 3×3 box; the corners are its diagonals.
    const cx = piece.x + 1
    const cy = piece.y + 1
    const corners = [
      [cx - 1, cy - 1],
      [cx + 1, cy - 1],
      [cx - 1, cy + 1],
      [cx + 1, cy + 1]
    ]
    return corners.filter(([x, y]) => this.field.isSolid(x, y)).length >= 3
  }

  public push(hard = false): void {
    if (!this.activePiece) throw new Error('Active piece undefined')
    let distance = 0
    while (!this.field.checkCollision(this.activePiece, 'down')) {
      this.activePiece.move('down')
      distance++
    }
    if (hard) this.score += hardDropScore(distance)
    // Travelling after the rotation means the piece *fell* into its slot rather
    // than being spun into it — so a hard drop across open space is never a spin.
    const spin = distance === 0 && this.isSpin(this.activePiece)
    const locked = this.activePiece
    const { cleared, lockOut } = this.field.placePiece(locked)
    this.events.onLock?.(hard)
    this.applyScore(cleared, spin)
    if (spin) this.events.onSpin?.(locked.name, cleared)
    if (cleared > 0) this.events.onClear?.(this.field.lastCleared, cleared, this.level)
    this.activePiece = undefined
    this.canHold = true
    this.clearPieceState()
    if (lockOut) this.setGameOver()
  }

  /** Per-piece bookkeeping — spin flags and the lock timer — back to zero. */
  private clearPieceState(): void {
    this.lastActionRotate = false
    this.lastRotateKicked = false
    this.lockTimer = 0
    this.lockResets = 0
    this.lowestRow = -Infinity
  }

  private applyScore(lines: number, spin = false): void {
    if (lines === 0) {
      // A spin with no clear still earns a small reward; combo resets as usual.
      // The back-to-back chain is *not* broken by a move that clears no lines.
      if (spin) this.score += spinNoClearScore(this.level)
      this.streak = 0
      return
    }
    this.streak++
    // A "difficult" clear — a Tetris (4 lines) or any spin clear — extends the
    // back-to-back chain; a plain 1–3 line clear breaks it. The bonus applies
    // from the second difficult clear onward (when a chain was already open).
    const difficult = spin || lines === 4
    const chained = difficult && this.b2b > 0
    this.b2b = difficult ? this.b2b + 1 : 0
    this.score += clearScore(lines, spin, this.level, chained)
    if (chained && this.activePiece) {
      this.events.onB2B?.(this.b2b, this.activePiece.name, lines)
    }
    const combo = this.streak - 1
    if (combo > 0) {
      this.score += comboScore(combo, this.level)
      this.events.onCombo?.(combo, this.level)
    }
    if (this.field.isEmpty()) {
      this.score += perfectClearScore(lines, this.level)
      this.events.onPerfectClear?.(lines, this.level)
    }
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

  /** Reset every bit of state and deal a fresh piece. Also the restart path. */
  public start(): void {
    this.field.reset()
    this._gameOver = false
    this.paused = false
    this.score = 0
    this.streak = 0
    this.b2b = 0
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
