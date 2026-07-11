import type P5 from 'p5'
import type { RGB } from '../core/color'

/**
 * Shared primitives for the p5-drawn chrome. Both the in-game HUD ({@link Ui})
 * and the menu ({@link Menu}) paint into an off-screen 2D buffer that is then
 * composited over the WEBGL scene, so they need the same panels, keycaps and
 * text metrics.
 */

export const FG: RGB = [238, 242, 255] // --fg
export const RED: RGB = [228, 92, 104] // game-over accent
export const PANEL: RGB = [18, 22, 38] // --panel
export const BAR: RGB = [10, 12, 22] // --bar
export const BORDER: RGB = [120, 140, 200]

export const MONO = 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace'

/** Set the canvas letter-spacing (Chromium supports `ctx.letterSpacing`). */
export function setTracking(g: P5.Graphics, px: number): void {
  ;(g.drawingContext as { letterSpacing: string }).letterSpacing = `${px}px`
}

export interface PanelStyle {
  /** Corner radius. */
  r: number
  fill: RGB
  /** Fill alpha, 0–255. */
  fillA: number
  /** Border alpha, 0–255. */
  strokeA: number
}

/** Rounded panel with a translucent fill and a hairline inner border. */
export function panel(g: P5.Graphics, x: number, y: number, w: number, h: number, style: PanelStyle): void {
  const { r, fill, fillA, strokeA } = style
  g.push()
  g.noStroke()
  g.fill(fill[0], fill[1], fill[2], fillA)
  g.rect(x, y, w, h, r)
  g.noFill()
  g.stroke(BORDER[0], BORDER[1], BORDER[2], strokeA)
  g.strokeWeight(1)
  g.rect(x + 0.5, y + 0.5, w - 1, h - 1, r)
  g.pop()
}

/** A single keycap, matching the old `<kbd>` styling. */
export function keycap(g: P5.Graphics, label: string, x: number, y: number, w: number, h: number, alpha = 1): void {
  g.push()
  g.noStroke()
  g.fill(120, 140, 200, 36 * alpha)
  g.rect(x, y, w, h, 5)
  g.noFill()
  g.stroke(140, 160, 220, 72 * alpha)
  g.strokeWeight(1)
  g.rect(x + 0.5, y + 0.5, w - 1, h - 1, 5)
  g.noStroke()
  g.fill(FG[0], FG[1], FG[2], 235 * alpha)
  g.textAlign(g.CENTER, g.CENTER)
  g.textSize(10)
  setTracking(g, 0)
  g.text(label, x + w / 2, y + h / 2 + 0.5)
  g.pop()
}

/** Width of a keycap sized to its label, with a sane minimum. */
export function keycapWidth(g: P5.Graphics, label: string): number {
  g.push()
  g.textSize(10)
  setTracking(g, 0)
  const w = Math.max(18, g.textWidth(label) + 12)
  g.pop()
  return w
}

/**
 * Composite a full-window 2D buffer over the WEBGL scene: unlit, so the scene
 * lights don't tint it, and depth-test-free, so it lands above everything.
 */
export function composite(p: P5, g: P5.Graphics): void {
  const gl = p.drawingContext as WebGLRenderingContext
  p.push()
  p.noLights()
  gl.disable(gl.DEPTH_TEST)
  p.imageMode(p.CORNER)
  p.image(g, -p.width / 2, -p.height / 2, p.width, p.height)
  gl.enable(gl.DEPTH_TEST)
  p.pop()
}

/** Create/resize a buffer to match the canvas. */
export function ensureBuffer(p: P5, current: P5.Graphics | undefined, w: number, h: number): P5.Graphics {
  if (!current) return p.createGraphics(w, h)
  if (current.width !== w || current.height !== h) current.resizeCanvas(w, h)
  return current
}
