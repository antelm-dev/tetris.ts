import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { BORDER, FG, setTracking } from './theme'

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

export interface FocusRingStyle {
  color: RGB
  alpha?: number
  r?: number
}

/** A focus outline for keyboard-navigated rows/regions, independent of any fill. */
export function focusRing(g: P5.Graphics, x: number, y: number, w: number, h: number, style: FocusRingStyle): void {
  const { color, alpha = 1, r = 10 } = style
  g.push()
  g.noFill()
  g.stroke(color[0], color[1], color[2], 200 * alpha)
  g.strokeWeight(1.5)
  g.rect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r)
  g.pop()
}

export interface ActionRowBackgroundOptions {
  color: RGB
  /** Panel fill alpha, 0–255. */
  washAlpha: number
  /** Panel border alpha, 0–255. */
  strokeAlpha: number
  /** Left-edge notch alpha, 0–255 — omit to skip the notch entirely. */
  notchAlpha?: number
  r?: number
}

/**
 * The tinted wash behind a menu row: a `panel()` fill plus an optional bright
 * left-edge notch. Shared by the always-on primary-action background and the
 * focus/deny highlight, which only differ in colour and alpha.
 */
export function actionRowBackground(
  g: P5.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: ActionRowBackgroundOptions
): void {
  const { color, washAlpha, strokeAlpha, notchAlpha, r = 10 } = opts
  panel(g, x, y, w, h, { r, fill: color, fillA: washAlpha, strokeA: strokeAlpha })
  if (!notchAlpha) return
  g.push()
  g.noStroke()
  g.fill(color[0], color[1], color[2], notchAlpha)
  g.rect(x + 1, y + 9, 3, h - 18, 2)
  g.pop()
}
