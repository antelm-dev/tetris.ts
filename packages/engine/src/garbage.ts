/**
 * The local Versus attack table: how many garbage lines a clear sends to the
 * opponent. Pure and framework-free, like `scoring.ts` — the match layer
 * calls this from the `onSpin`/`onClear` events, it never lives inside the
 * engine's own scoring path.
 */

/** Garbage lines sent for a plain clear, indexed by line count (0–4). */
const LINE_ATTACK = [0, 0, 1, 2, 4] as const

/** Garbage lines sent for a spin clear, indexed by line count (0–4). */
const SPIN_ATTACK = [0, 2, 4, 6, 6] as const

export const ATTACK_TABLE = {
  single: LINE_ATTACK[1],
  double: LINE_ATTACK[2],
  triple: LINE_ATTACK[3],
  tetris: LINE_ATTACK[4],
  tSpinSingle: SPIN_ATTACK[1],
  tSpinDouble: SPIN_ATTACK[2],
  tSpinTriple: SPIN_ATTACK[3]
} as const

/** Garbage lines a clear of `lines` rows (spin or not) sends to the opponent. */
export function computeAttack(lines: number, spin: boolean): number {
  if (lines <= 0) return 0
  const table = spin ? SPIN_ATTACK : LINE_ATTACK
  return table[lines] ?? (table.at(-1) as number)
}
