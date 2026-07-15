import { COLS, ROWS } from '../core/geometry'
import { computeAttack, Game, type RandomFn } from '../engine'
import { Effects } from '../scene/effects'
import { Flashes } from '../scene/flashes'
import { Ui } from '../hud/ui'
import { BotController } from '../bot/controller'
import { createBotStrategy, DIFFICULTY_CONFIG } from '../bot/difficulty'
import type { BotDifficulty } from '../bot/types'
import { wireEvents } from './events'
import { Gravity, PieceMotion } from './loop'

/**
 * A local Versus match: one human-controlled `Game`, one bot-controlled
 * `Game`, independent presentation state for each, and the attack/garbage
 * rules that connect them. Owns win-condition and garbage timing itself —
 * neither is derived from animation callbacks, only from the engine's own
 * `onLock`/`onSpin`/`onClear`/`onGameOver` events.
 */

export type Side = 'player' | 'bot'

export interface VersusSide {
  game: Game
  gravity: Gravity
  motion: PieceMotion
  fx: Effects
  flashes: Flashes
  /**
   * Wired for score/overlay bookkeeping via `wireEvents` (reused as-is from
   * solo) but deliberately never `.paint()`-ed in Versus — `VersusHud` owns
   * what's actually drawn, so solo's full-screen vignette/legend/overlay
   * never render twice.
   */
  ui: Ui
}

export interface VersusMatchOptions {
  /** Powers the bot's `Game` (piece bag + garbage-hole RNG). Defaults to `Math.random`. */
  random?: RandomFn
  /** Powers the bot strategy's noise-based placement selection. Defaults to `Math.random`. */
  strategyRandom?: RandomFn
}

export class VersusMatch {
  public readonly player: VersusSide
  public readonly bot: VersusSide
  public readonly difficulty: BotDifficulty
  private readonly botController: BotController
  private over = false
  private _winner?: Side
  /**
   * Match-wide pause, driven by the player's own pause bind (see `wireSide`'s
   * `onPause` hook) — so Escape freezes *both* boards together instead of
   * just the human's, which otherwise let the bot keep playing unopposed
   * while the player's piece sat frozen mid-air.
   */
  private paused = false

  private readonly pendingGarbage: Record<Side, number> = { player: 0, bot: 0 }
  private readonly frameAttack: Record<Side, number> = { player: 0, bot: 0 }
  private readonly lastLockSpin: Record<Side, boolean> = { player: false, bot: false }

  public constructor(difficulty: BotDifficulty, options: VersusMatchOptions = {}) {
    this.difficulty = difficulty
    this.player = buildSide(Math.random)
    this.bot = buildSide(options.random ?? Math.random)

    const strategy = createBotStrategy(difficulty, options.strategyRandom ?? Math.random)
    this.botController = new BotController(this.bot.game, strategy, DIFFICULTY_CONFIG[difficulty].actionDelayMs)

    this.wireSide('player', this.player)
    this.wireSide('bot', this.bot)

    this.player.game.start()
    this.bot.game.start()
  }

  public get isOver(): boolean {
    return this.over
  }

  public get winner(): Side | undefined {
    return this._winner
  }

  public get isPaused(): boolean {
    return this.paused
  }

  /** Advance both boards and resolve one frame's worth of attacks. Frozen once the match ends or is paused. */
  public update(dt: number): void {
    if (this.over || this.paused) return
    this.advance(this.player, dt)
    this.advance(this.bot, dt)
    this.botController.update(dt)
    this.resolveAttacks()
  }

  private advance(side: VersusSide, dt: number): void {
    const g = side.game
    if (!g.isPaused && !g.gameOver) {
      side.gravity.update(dt, g)
      g.tick(dt)
    }
    side.motion.update(dt, g)
    side.flashes.update(dt)
    side.fx.update(dt)
  }

  /** Net this frame's outgoing attacks against each other, then queue the remainder. */
  private resolveAttacks(): void {
    const net = this.frameAttack.player - this.frameAttack.bot
    if (net > 0) this.pendingGarbage.bot += net
    else if (net < 0) this.pendingGarbage.player += -net
    this.frameAttack.player = 0
    this.frameAttack.bot = 0
  }

  private endMatch(winner: Side): void {
    if (this.over) return
    this.over = true
    this._winner = winner
  }

  private wireSide(side: Side, s: VersusSide): void {
    wireEvents(s.game, { fx: s.fx, ui: s.ui, flashes: s.flashes, motion: s.motion, gravity: s.gravity })
    const base = s.game.events

    s.game.events = {
      ...base,
      onSpawn: (name) => {
        base.onSpawn?.(name)
        if (side === 'bot') this.botController.onSpawn()
      },
      onSpin: (name, lines) => {
        this.lastLockSpin[side] = true
        base.onSpin?.(name, lines)
      },
      onClear: (rows, count, level) => {
        base.onClear?.(rows, count, level)
        this.frameAttack[side] += computeAttack(count, this.lastLockSpin[side])
      },
      onLock: (hard) => {
        // Reset *before* this same lock's own `onSpin` (fired next, still
        // inside the same synchronous `push()` call) has a chance to set it.
        this.lastLockSpin[side] = false
        base.onLock?.(hard)
        if (side === 'bot') this.botController.onLock()
        const pending = this.pendingGarbage[side]
        if (pending > 0) {
          this.pendingGarbage[side] = 0
          s.game.receiveGarbage(pending)
        }
      },
      onGameOver: (score) => {
        base.onGameOver?.(score)
        this.endMatch(side === 'player' ? 'bot' : 'player')
      },
      // Only the player's own pause bind (nothing ever pauses the bot's
      // Game directly) drives the match-wide pause that freezes both sides.
      onPause: (paused) => {
        base.onPause?.(paused)
        if (side === 'player') this.paused = paused
      }
    }
  }
}

function buildSide(random: RandomFn): VersusSide {
  return {
    game: new Game({ width: COLS, height: ROWS, random }),
    gravity: new Gravity(),
    motion: new PieceMotion(),
    fx: new Effects(),
    flashes: new Flashes(),
    ui: new Ui()
  }
}
