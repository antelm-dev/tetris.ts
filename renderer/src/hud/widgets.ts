import type P5 from 'p5'
import type { RGB } from '../core/color'
import { clamp01, easeK, smooth } from '../core/ease'

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

// --- clipping ----------------------------------------------------------------

/**
 * Clip subsequent drawing to a rect in the graphics' current local space (so
 * it composes correctly under an existing translate/scale). Pair with
 * {@link unclip}; internally just a `push()`/`pop()` with a canvas clip path,
 * since p5's 2D renderer saves/restores the clip region like any other state.
 */
export function clipRect(g: P5.Graphics, x: number, y: number, w: number, h: number): void {
  g.push()
  const ctx = g.drawingContext as CanvasRenderingContext2D
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
}

/** Undo the clip pushed by {@link clipRect}. */
export function unclip(g: P5.Graphics): void {
  g.pop()
}

// --- scrolling -----------------------------------------------------------------

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

// --- toasts --------------------------------------------------------------------

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

// --- menu-row helpers ------------------------------------------------------------

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

// --- text --------------------------------------------------------------------

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
