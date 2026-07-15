import type { PieceName } from './const'

export type { PieceName }

export type Direction = 'left' | 'right' | 'down'
export type Rotate = `rotate-${'right' | 'left'}`
export type Action = Direction | Rotate | 'push' | 'pause' | 'hold'
/** `'GARBAGE'` is a filled cell with no owning piece — see `Field.addGarbage`. */
export type Slot = PieceName | 'GARBAGE' | 0

/**
 * Optional, fire-and-forget callbacks the renderer can attach to a `Game` to
 * drive visual/audio "juice" (particles, screen-shake, flashes). The engine
 * itself never depends on these — every hook is optional and defaults to a
 * no-op, so headless/unit-test usage is unaffected.
 */
export interface GameEvents {
  /** A new piece became active (spawn or hold-swap). */
  onSpawn?: (name: PieceName) => void
  /** The active piece was nudged left/right. */
  onMove?: (dir: 'left' | 'right') => void
  /** The active piece rotated. `kicked` is true when a wall kick was needed. */
  onRotate?: (kicked: boolean) => void
  /**
   * A piece locked while immobile right after a rotation — a spin (T-spin,
   * L-spin, S-spin, …). `lines` is how many rows it cleared (0–4).
   */
  onSpin?: (name: PieceName, lines: number) => void
  /**
   * A back-to-back difficult clear landed — a Tetris (4-line) or any spin
   * clear immediately following another difficult clear, with no plain clear
   * breaking the chain. `chain` is the running count of difficult clears
   * (≥ 2 whenever this fires), `lines` how many rows this clear removed.
   */
  onB2B?: (chain: number, name: PieceName, lines: number) => void
  /**
   * A combo continued — a clear made while a run of consecutive clears was
   * already going. `combo` is the number of clears past the first (≥ 1 here),
   * `level` the level the bonus was scored at.
   */
  onCombo?: (combo: number, level: number) => void
  /** A piece just locked into the field. `hard` is true for a hard drop. */
  onLock?: (hard: boolean) => void
  /** One or more rows were completed. `rows` are the (pre-collapse) indices. */
  onClear?: (rows: number[], count: number, level: number) => void
  /**
   * A clear emptied the well — all clear / perfect clear. `lines` is how many
   * rows that clear removed; `level` is the level the bonus was scored at.
   */
  onPerfectClear?: (lines: number, level: number) => void
  /** The level increased. */
  onLevelUp?: (level: number) => void
  /** The active piece was stashed to hold. */
  onHold?: () => void
  /** Pause was toggled. */
  onPause?: (paused: boolean) => void
  /** The game just ended. */
  onGameOver?: (score: number) => void
  /** A fresh game started (also fired on restart). */
  onStart?: () => void
  /** Garbage rows were just pushed into the field via `Game.receiveGarbage`. */
  onGarbageReceived?: (count: number) => void
  /**
   * The active mode's target was reached — a successful completion, distinct
   * from `onGameOver`. `lines`/`elapsedMs` are the run's final totals.
   */
  onComplete?: (score: number, elapsedMs: number, lines: number) => void
}
