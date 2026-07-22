export const DAS = 150
export const ARR = 38
export const SOFT_DROP = 45

export type RepeatState = {
  timer: number
  repeating: boolean
}

/**
 * Advance a DAS/ARR (or soft-drop) repeat clock by `ms`. Returns how many
 * auto-repeat steps should fire. When `held` is false the clock is left alone
 * so a brief gap between keys does not invent progress; callers reset on press.
 */
export function tickRepeat(
  state: RepeatState,
  ms: number,
  held: boolean,
  das: number,
  arr: number
): { state: RepeatState; fires: number } {
  if (!held) return { state, fires: 0 }

  let timer = state.timer + ms
  let repeating = state.repeating
  let fires = 0
  let threshold = repeating ? arr : das
  while (timer >= threshold) {
    timer -= threshold
    fires++
    repeating = true
    threshold = arr
  }
  return { state: { timer, repeating }, fires }
}

/** Most-recent horizontal direction wins when both are held. */
export function resolveHorizontal(
  left: boolean,
  right: boolean,
  last?: 'left' | 'right'
): 'left' | 'right' | undefined {
  if (left && right) return last
  if (left) return 'left'
  if (right) return 'right'
  return undefined
}
