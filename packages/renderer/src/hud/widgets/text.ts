import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { BORDER, FG, setTracking } from './theme'

/** A small caps label followed by a rule filling the remaining width. */
export function sectionLabel(
  g: P5.Graphics,
  text: string,
  x: number,
  y: number,
  ruleEndX: number,
  alpha: number
): void {
  const label = text.toUpperCase()
  g.push()
  g.noStroke()
  g.fill(FG[0], FG[1], FG[2], 0.4 * 255 * alpha)
  g.textAlign(g.LEFT, g.CENTER)
  g.textSize(10)
  setTracking(g, 2.2)
  g.text(label, x, y)
  const tx = x + g.textWidth(label) + 22
  g.stroke(BORDER[0], BORDER[1], BORDER[2], 34 * alpha)
  g.strokeWeight(1)
  g.line(tx, y, ruleEndX, y)
  g.pop()
}

/** Small caps label centred above a panel (e.g. HOLD / NEXT). */
export function panelLabel(g: P5.Graphics, text: string, cx: number, y: number, color: RGB, alpha = 1): void {
  g.push()
  g.noStroke()
  g.fill(color[0], color[1], color[2], 255 * alpha)
  g.textAlign(g.CENTER, g.BOTTOM)
  g.textSize(11)
  setTracking(g, 2)
  g.text(text.toUpperCase(), cx, y)
  g.pop()
}

/** Trim `text` with a trailing ellipsis until it fits `maxWidth` at the graphics' current text style. */
export function truncate(g: P5.Graphics, text: string, maxWidth: number): string {
  if (g.textWidth(text) <= maxWidth) return text
  const ellipsis = '…'
  let out = text
  while (out.length > 0 && g.textWidth(out + ellipsis) > maxWidth) {
    out = out.slice(0, -1)
  }
  return out.length > 0 ? out + ellipsis : ellipsis
}
