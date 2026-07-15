import type { RGB } from '../../core/color'
import type { ReducedMotionPref } from '../../config/settings'
import type { PieceName } from '../../engine'
import type { BotDifficulty } from '../../bot/types'
import type { Entry, Rect } from './types'

/**
 * Layout constants and small pure helpers for the menu card — kept separate
 * from {@link Menu} so the geometry/model can be read without the input and
 * painting logic around it.
 */

export const DIFFICULTY_ORDER: BotDifficulty[] = ['easy', 'normal', 'hard']
export const DIFFICULTY_LABELS: Record<BotDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }

export const CARD_W = 500
export const PAD_X = 30
export const ROW_H = 42
export const ROW_GAP = 6
export const HEADING_H = 30
export const TITLE_H = 104
export const FOOTER_H = 44
export const CARD_MARGIN_X = 20
export const CARD_MARGIN_Y = 24
export const MIN_VIEWPORT_H = ROW_H * 3
export const WHEEL_STEP = 0.5
export const INTENSITY_STEP = 0.1
export const RESET_CONFIRM_WINDOW = 4
export const PRIMARY_TEXT_SIZE = 17
export const PRIMARY_IDLE_WASH_A = 26
export const PRIMARY_IDLE_STROKE_A = 70
export const TOAST_HALF_H = 24
export const TOAST_PAD = 12
export const SCROLL_INDICATOR_X = CARD_W - 14

export const DIM: RGB = [4, 6, 12]
export const SLOT_ORDER: PieceName[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

export function reducedMotionLabel(pref: ReducedMotionPref): string {
  if (pref === 'auto') return 'Auto'
  return pref === 'on' ? 'On' : 'Off'
}

export function entryHeight(e: Entry): number {
  if (e.kind === 'heading') return HEADING_H
  if (e.kind === 'gap') return e.h
  return ROW_H
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}
