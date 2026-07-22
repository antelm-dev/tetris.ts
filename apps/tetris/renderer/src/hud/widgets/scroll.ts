import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { easeK } from '../../core/ease'

export interface ScrollState {
  /** Eased, on-screen scroll position. */
  offset: number
  /** Where `offset` is easing toward. */
  target: number
  /** Height of the visible window, in local units. */
  viewport: number
  /** Total height of the scrollable content, in local units. */
  content: number
}

export function createScrollState(): ScrollState {
  return { offset: 0, target: 0, viewport: 0, content: 0 }
}

function maxScroll(s: ScrollState): number {
  return Math.max(0, s.content - s.viewport)
}

/** Ease `offset` toward `target`, clamped to the current scrollable range. */
export function updateScroll(s: ScrollState, dt: number, rate = 18): void {
  s.target = Math.max(0, Math.min(maxScroll(s), s.target))
  s.offset += (s.target - s.offset) * easeK(dt, rate)
  if (Math.abs(s.target - s.offset) < 0.05) s.offset = s.target
}

/** Nudge the scroll target (e.g. by a wheel delta); clamped on the next {@link updateScroll}. */
export function scrollBy(s: ScrollState, dy: number): void {
  s.target = Math.max(0, Math.min(maxScroll(s), s.target + dy))
}

/** Scroll just enough that the local range `[top, top+h]` is fully visible. */
export function scrollIntoView(s: ScrollState, top: number, h: number, margin = 8): void {
  const viewTop = s.target
  const viewBottom = s.target + s.viewport
  if (top - margin < viewTop) s.target = Math.max(0, top - margin)
  else if (top + h + margin > viewBottom) s.target = Math.min(maxScroll(s), top + h + margin - s.viewport)
}

/** A thin track + proportional thumb on the right edge of a scrollable region. */
export function drawScrollIndicator(
  g: P5.Graphics,
  x: number,
  y: number,
  h: number,
  s: ScrollState,
  color: RGB,
  alpha = 1
): void {
  if (s.content <= s.viewport) return
  const w = 3
  g.push()
  g.noStroke()
  g.fill(color[0], color[1], color[2], 40 * alpha)
  g.rect(x, y, w, h, w / 2)
  const thumbH = Math.max(20, (s.viewport / s.content) * h)
  const thumbY = y + (h - thumbH) * (s.offset / maxScroll(s))
  g.fill(color[0], color[1], color[2], 150 * alpha)
  g.rect(x, thumbY, w, thumbH, w / 2)
  g.pop()
}
