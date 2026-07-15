import type P5 from 'p5'
import type { RGB } from '../../core/color'

/**
 * Shared palette + text metrics for the p5-drawn chrome. Both the in-game HUD
 * ({@link Ui}) and the menu ({@link Menu}) paint into an off-screen 2D buffer
 * that is then composited over the WEBGL scene, so they need the same colors
 * and letter-spacing helper.
 */

export const FG: RGB = [238, 242, 255] // --fg
export const RED: RGB = [228, 92, 104] // game-over accent
export const PANEL: RGB = [18, 22, 38] // --panel
export const BAR: RGB = [10, 12, 22] // --bar
export const BORDER: RGB = [120, 140, 200]

export const MONO = 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace'

/** Shared alpha multiplier for a disabled row/label. */
export const DISABLED_DIM = 0.38

/** Matches `#titlebar` height in `styles.css`. Hidden while `body.is-fullscreen`. */
export const TITLEBAR_H = 34

export function titlebarClearance(): number {
  if (document.body.classList.contains('is-fullscreen')) return 0
  return document.getElementById('titlebar') ? TITLEBAR_H : 0
}

/** Set the canvas letter-spacing (Chromium supports `ctx.letterSpacing`). */
export function setTracking(g: P5.Graphics, px: number): void {
  ;(g.drawingContext as { letterSpacing: string }).letterSpacing = `${px}px`
}
