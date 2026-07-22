/**
 * Guideline-style scoring tables and helpers. All returned values are integers.
 *
 * Line-clear and spin base values scale with the current level. Soft drop is
 * 1 point per cell; hard drop is 2. Combo and back-to-back stack on top of the
 * scaled clear (B2B multiplies the clear, combo adds afterward).
 */

const LINE_SCORES = [0, 100, 300, 500, 800] as const
const SPIN_SCORES = [0, 800, 1200, 1600, 1600] as const
const PERFECT_CLEAR = [0, 800, 1200, 1800, 2000] as const

/** Multiplier for the second and later difficult clears in a back-to-back chain. */
export const B2B_MULTIPLIER = 1.5

/** Per-step combo bonus: `COMBO_BONUS × combo × level`. */
export const COMBO_BONUS = 50

/** Points for a spin that locks without clearing a line (× level). */
export const SPIN_NO_CLEAR = 100

function pick(table: readonly number[], lines: number): number {
  return table[lines] ?? (table.at(-1) as number)
}

/** Base line-clear or spin-clear score at `level`, with optional B2B multiplier. */
export function clearScore(lines: number, spin: boolean, level: number, b2b: boolean): number {
  const base = pick(spin ? SPIN_SCORES : LINE_SCORES, lines) * level
  return b2b ? Math.floor(base * B2B_MULTIPLIER) : base
}

export function comboScore(combo: number, level: number): number {
  return combo > 0 ? COMBO_BONUS * combo * level : 0
}

export function spinNoClearScore(level: number): number {
  return SPIN_NO_CLEAR * level
}

export function softDropScore(cells: number): number {
  return Math.max(0, cells)
}

export function hardDropScore(cells: number): number {
  return Math.max(0, cells) * 2
}

/** Perfect-clear bonus after a clear that empties the well (× level). */
export function perfectClearScore(lines: number, level: number): number {
  if (lines <= 0) return 0
  return pick(PERFECT_CLEAR, lines) * level
}
