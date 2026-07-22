import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { sidePanelX, CELL } from '../../core/geometry'
import { fitScale } from '../../scene/camera'
import { titlebarClearance } from '../widgets'
import type { MoveDraft } from './types'

/**
 * Layout constants and small pure helpers for the in-game HUD — kept separate
 * from {@link Ui} so the geometry/model can be read without the animation and
 * painting logic around it.
 */

export const GOLD: RGB = [255, 224, 130]
export const CYAN: RGB = [140, 235, 255]
export const LINE_LABELS = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'] as const

export const emptyDraft = (): MoveDraft => ({ lines: -1, b2b: 0, combo: 0, perfectClear: false, dirty: false })

// --- compact HUD panel layout ------------------------------------------------
export const HUD_PAD = 16
export const HUD_MIN_W = 120
export const HUD_MAX_W = 200
export const HUD_PAD_IN = 8
export const HUD_PRIMARY_ROW_H = 34
export const HUD_ROW_GAP = 4
export const HUD_SECONDARY_ROW_H = 26
export const HUD_PANEL_H = HUD_PAD_IN * 2 + HUD_PRIMARY_ROW_H + HUD_ROW_GAP + HUD_SECONDARY_ROW_H
export const HUD_CALLOUT_GAP = 8
export const MODE_LABEL_CLEARANCE = 20
export const PULSE_SCALE_PRIMARY = 0.22
export const PULSE_SCALE_SECONDARY = 0.12
export const SIDE_PANEL_HALF = CELL * 1.7
export const SIDE_PANEL_LABEL_GAP = 14

export const START_HINT_HOLD = 4.5
export const START_HINT_TEXT = 'TAB CONTROLS  ·  ESC PAUSE'

export function chromeTop(): number {
  return titlebarClearance() + HUD_PAD
}

/**
 * Local width of the compact HUD at `chromeScale` 1. Widest local size that
 * still keeps the scaled panel clear of the hold frame.
 */
export function hudLocalWidth(p: P5, scale: number): number {
  const s = fitScale(p)
  const holdFrameLeftX = p.width / 2 - (sidePanelX() + SIDE_PANEL_HALF) * s
  const maxScreenW = holdFrameLeftX - HUD_PAD * 2
  return Math.max(HUD_MIN_W, Math.min(HUD_MAX_W, maxScreenW / scale))
}
