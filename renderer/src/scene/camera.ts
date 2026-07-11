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

/** Set up the orthographic projection. Call once per frame, before drawing. */
export function applyProjection(p: P5): void {
  p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, -3000, 3000)
}

/**
 * Run `draw` inside the world transform — screen shake, fit-scale, tilt, sway.
 * Used twice a frame (backdrop, then board), so they share a camera and move
 * together.
 */
export function inWorld(p: P5, fx: Effects, angle: number, draw: () => void): void {
  p.push()
  fx.applyShake(p)
  p.scale(fitScale(p))
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
