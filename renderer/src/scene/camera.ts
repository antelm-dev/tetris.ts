import type P5 from 'p5'
import { CELL, COLS, ROWS } from '../core/geometry'
import type { Effects } from './effects'

/**
 * The one camera the scene has: an orthographic view with a fixed tilt and a
 * slow sway, scaled so the board and its side panels always fit the window.
 * There is no free orbit — the tilt exists to give the blocks depth, not to be
 * flown around.
 */

/** Fixed downward tilt, in radians. */
const TILT = -0.13

/** Slow left/right drift of the whole scene, for a living, 3D feel. */
export function sway(frameCount: number): number {
  return Math.sin(frameCount * 0.006) * 0.03
}

/** Scale that fits the well plus its side panels into the window. */
export function fitScale(p: P5): number {
  const contentW = (COLS + 12) * CELL
  const contentH = (ROWS + 3) * CELL
  return Math.min(p.width / contentW, p.height / contentH) * 0.96
}

/** Footprint (board + side panels) of one board, in unscaled world units. */
const BOARD_CONTENT_W = (COLS + 12) * CELL
const BOARD_CONTENT_H = (ROWS + 3) * CELL

/** Fraction of the window's width given to each board's column — an even split. */
const COLUMN_FRACTION = 0.5

/** Scale that fits one board's content into a `columnW`×`h` cell of the grid. */
function columnFitScale(columnW: number, h: number): number {
  return Math.min(columnW / BOARD_CONTENT_W, h / BOARD_CONTENT_H) * 0.94
}

/**
 * A two-column grid for the Versus layout: player on the left, bot on the
 * right, each centred in an equal-width column and drawn at the *same*
 * scale — same size, same footprint, so the two boards read as a genuine
 * split screen rather than one shrunk relative to the other.
 *
 * The returned `x`/`scale` are final, ready to feed straight into
 * {@link withBoard} inside an `inWorld(..., 1, ...)` call — no further
 * scaling should be applied on top.
 */
export function versusOffsets(p: Pick<P5, 'width' | 'height'>): {
  player: { x: number; scale: number }
  bot: { x: number; scale: number }
} {
  const w = p.width
  const h = p.height
  const columnW = w * COLUMN_FRACTION
  const scale = columnFitScale(columnW, h)
  return {
    player: { x: -w / 2 + columnW / 2, scale },
    bot: { x: w / 2 - columnW / 2, scale }
  }
}

/**
 * Draw `draw` for one board of a Versus layout, at its own offset/scale from
 * {@link versusOffsets}. Call inside `inWorld(..., 1, ...)` — the `1` matters:
 * these offsets/scales are already final, so the shared world scale must be
 * neutral or the board would be sized and positioned by the product of the
 * two scales instead of just its own.
 */
export function withBoard(p: P5, offsetX: number, scale: number, draw: () => void): void {
  p.push()
  p.translate(offsetX, 0, 0)
  p.scale(scale)
  draw()
  p.pop()
}

/** Default Electron window size — chrome is authored against this. */
const CHROME_REF_W = 1024
const CHROME_REF_H = 768

/**
 * Mild scale for 2D HUD chrome relative to the default window. Grows slower
 * than the 3D `fitScale` so the score panel tracks the board without ballooning.
 */
export function chromeScale(p: Pick<P5, 'width' | 'height'>): number {
  const raw = Math.min(p.width / CHROME_REF_W, p.height / CHROME_REF_H)
  return Math.min(1.28, Math.max(0.92, 1 + (raw - 1) * 0.55))
}

/** Set up the orthographic projection. Call once per frame, before drawing. */
export function applyProjection(p: P5): void {
  p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, -3000, 3000)
}

/**
 * Run `draw` inside the world transform — screen shake, fit-scale, tilt, sway.
 * Used twice a frame (backdrop, then board), so they share a camera and move
 * together. `scale` is `fitScale(p)` for solo and {@link versusFitScale}(p)
 * for Versus — one shared camera either way, just budgeted for one or two
 * boards.
 */
export function inWorld(p: P5, fx: Effects, angle: number, scale: number, draw: () => void): void {
  p.push()
  fx.applyShake(p)
  p.scale(scale)
  p.rotateX(TILT)
  p.rotateY(angle)
  draw()
  p.pop()
}

/** The scene lights. Must be applied *after* the backdrop, so it never dims it. */
export function applyLights(p: P5): void {
  p.ambientLight(58, 62, 82)
  p.directionalLight(255, 252, 245, -0.35, -0.55, -0.72)
  p.pointLight(90, 130, 235, -260, -360, 520)
  p.pointLight(60, 60, 90, 320, 340, 420)
}
