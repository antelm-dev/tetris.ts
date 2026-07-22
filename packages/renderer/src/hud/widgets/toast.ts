import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { clamp01, smooth } from '../../core/ease'
import { FG, setTracking } from './theme'

export interface Toast {
  id: number
  text: string
  sub?: string
  /** `accent` matches the old high-score banner look; `neutral` is quieter, for settings confirmations. */
  tone: 'accent' | 'neutral'
  /** Seconds remaining before it starts fading out. */
  life: number
  /** Eased presence, 0 → 1. */
  appear: number
}

export interface ToastQueueState {
  queue: Toast[]
  active?: Toast
  nextId: number
}

export const TOAST_HOLD = 2.5
export const TOAST_APPEAR_RATE = 6

export function createToastQueue(): ToastQueueState {
  return { queue: [], nextId: 1 }
}

export function pushToast(
  q: ToastQueueState,
  text: string,
  opts: { sub?: string; tone?: Toast['tone']; hold?: number } = {}
): void {
  q.queue.push({
    id: q.nextId++,
    text,
    sub: opts.sub,
    tone: opts.tone ?? 'neutral',
    life: opts.hold ?? TOAST_HOLD,
    appear: 0
  })
}

/** Age the active toast, and promote the next queued one once it's fully faded. */
export function updateToastQueue(q: ToastQueueState, dt: number): void {
  if (!q.active && q.queue.length > 0) q.active = q.queue.shift()
  const t = q.active
  if (!t) return
  if (t.life > 0) {
    t.life -= dt
    t.appear = Math.min(1, t.appear + dt * TOAST_APPEAR_RATE)
  } else {
    t.appear = Math.max(0, t.appear - dt * TOAST_APPEAR_RATE)
    if (t.appear <= 0) q.active = undefined
  }
}

interface ToastStyle {
  color: RGB
  textSize: number
  tracking: number
  strokeAlpha: number
  strokeWeight: number
  glow: boolean
}

function toastStyle(tone: Toast['tone'], accent: RGB): ToastStyle {
  if (tone === 'accent')
    return { color: accent, textSize: 20, tracking: 2, strokeAlpha: 255, strokeWeight: 2, glow: true }
  return { color: FG, textSize: 14, tracking: 0.4, strokeAlpha: 130, strokeWeight: 1, glow: false }
}

function drawToastText(g: P5.Graphics, style: ToastStyle, text: string, sub: string | undefined, a: number): void {
  const dc = g.drawingContext as CanvasRenderingContext2D
  g.noStroke()
  g.fill(style.color[0], style.color[1], style.color[2], 255 * a)
  g.textAlign(g.CENTER, g.CENTER)
  g.textSize(style.textSize)
  setTracking(g, style.tracking)
  if (style.glow) {
    dc.shadowColor = `rgba(${style.color[0]}, ${style.color[1]}, ${style.color[2]}, ${0.5 * a})`
    dc.shadowBlur = 20
  }
  g.text(text, -1, sub ? -9 : 0)
  dc.shadowBlur = 0

  if (!sub) return
  g.fill(FG[0], FG[1], FG[2], 190 * a)
  g.textAlign(g.CENTER, g.CENTER)
  g.textSize(11)
  setTracking(g, 0.4)
  g.text(sub, -0.5, 15)
}

/** Draw the active toast, if any, centred horizontally at `anchorY`. */
export function drawToast(g: P5.Graphics, w: number, t: Toast | undefined, accent: RGB, anchorY: number): void {
  if (!t) return
  const a = smooth(clamp01(t.appear))
  if (a <= 0.004) return
  const style = toastStyle(t.tone, accent)
  const text = t.tone === 'accent' ? t.text.toUpperCase() : t.text

  g.textSize(style.textSize)
  setTracking(g, style.tracking)
  const tw = g.textWidth(text)
  g.textSize(11)
  setTracking(g, 0.4)
  const subW = t.sub ? g.textWidth(t.sub) : 0
  const bw = Math.max(tw, subW) + 52
  const bh = t.sub ? 60 : 48

  g.push()
  g.translate(w / 2, anchorY)
  g.scale(0.9 + 0.1 * a)

  g.noStroke()
  g.fill(10, 12, 22, 0.82 * 255 * a)
  g.rect(-bw / 2, -bh / 2, bw, bh, 10)
  g.noFill()
  g.stroke(style.color[0], style.color[1], style.color[2], style.strokeAlpha * a)
  g.strokeWeight(style.strokeWeight)
  g.rect(-bw / 2, -bh / 2, bw, bh, 10)

  drawToastText(g, style, text, t.sub, a)
  g.pop()
}
