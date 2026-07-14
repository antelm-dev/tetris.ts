import type P5 from 'p5'
import { mix, type RGB } from '../core/color'
import { hump, smooth } from '../core/ease'
import { CELL, sidePanelTop, sidePanelX } from '../core/geometry'
import { BIND_LABELS, BINDS, keyLabel } from '../config/keymap'
import { settings } from '../config/settings'
import { PALETTE, UI } from '../config/themes'
import type { PieceName } from '../engine'
import { chromeScale, fitScale } from '../scene/camera'
import {
  BAR,
  composite,
  createToastQueue,
  drawToast,
  ensureBuffer,
  FG,
  keycap,
  keycapWidth,
  MONO,
  panel,
  panelLabel,
  PANEL,
  pushToast,
  RED,
  setTracking,
  truncate,
  updateToastQueue,
  type ToastQueueState
} from './widgets'

/**
 * The game's chrome — score HUD, controls legend, pause/game-over overlay and
 * the notification toast — drawn entirely in p5 rather than as DOM elements.
 *
 * Everything is painted into an off-screen 2D graphics buffer each frame and
 * then composited over the WEBGL scene as a single unlit, depth-test-free image
 * (see {@link Ui.paint}). Only the frameless titlebar remains in HTML/CSS, so it
 * can keep its native `-webkit-app-region: drag` behaviour.
 */

type StatKey = 'score' | 'best' | 'level' | 'lines'

interface Stat {
  label: string
  value: string
  /** Decays 1 → 0; drives the brief scale/colour pulse on a value change. */
  bump: number
}

interface OverlayState {
  title: string
  sub: string
  kind: 'pause' | 'over'
  shown: boolean
  t: number // eased opacity, 0 → 1
}

/** Draft filled by spin/clear/B2B/combo/PC hooks in one push, flushed in update. */
interface MoveDraft {
  spin?: PieceName
  lines: number
  b2b: number
  combo: number
  perfectClear: boolean
  dirty: boolean
}

interface MoveCallout {
  title: string
  sub: string
  b2b: number
  combo: number
  color: RGB
  life: number
  appear: number
  pop: number
}

interface LegendEntry {
  keys: string[]
  label: string
  keyW: number[]
  width: number
}

const GOLD: RGB = [255, 224, 130]
const CYAN: RGB = [140, 235, 255]
const LINE_LABELS = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'] as const

const emptyDraft = (): MoveDraft => ({ lines: -1, b2b: 0, combo: 0, perfectClear: false, dirty: false })

// --- compact HUD panel layout ------------------------------------------------
const HUD_PAD = 16 // outer margin from the window edge
const TITLEBAR_H = 34 // custom frameless titlebar in styles.css
const HUD_MIN_W = 120
const HUD_MAX_W = 220
const HUD_PAD_IN = 12 // inner panel padding
const HUD_PRIMARY_ROW_H = 42 // Score / Level row (label + big value)
const HUD_ROW_GAP = 4
const HUD_SECONDARY_ROW_H = 22 // Best · Lines row
const HUD_PANEL_H = HUD_PAD_IN * 2 + HUD_PRIMARY_ROW_H * 2 + HUD_ROW_GAP * 2 + HUD_SECONDARY_ROW_H
const HUD_CALLOUT_GAP = 8
/** How much the value pulses on a change — reduced-motion drops this to 0. */
const PULSE_SCALE_PRIMARY = 0.22
const PULSE_SCALE_SECONDARY = 0.12
/** Half the `drawPanel` frame's `CELL*3.4` plane — keeps the HUD clear of the hold panel. */
const SIDE_PANEL_HALF = CELL * 1.7
const SIDE_PANEL_LABEL_GAP = 14

const START_HINT_HOLD = 4.5
const START_HINT_TEXT = 'TAB CONTROLS  ·  ESC PAUSE'

/** Titlebar is hidden in fullscreen (see `body.is-fullscreen` in styles.css). */
function titlebarClearance(): number {
  return document.body.classList.contains('is-fullscreen') ? 0 : TITLEBAR_H
}

/** Top edge for top-anchored chrome — clears the titlebar when it is visible. */
function chromeTop(): number {
  return titlebarClearance() + HUD_PAD
}

/**
 * Local width of the compact HUD at `chromeScale` 1. Widest local size that
 * still keeps the scaled panel clear of the hold frame.
 */
function hudLocalWidth(p: P5, scale: number): number {
  const s = fitScale(p)
  const holdFrameLeftX = p.width / 2 - (sidePanelX() + SIDE_PANEL_HALF) * s
  const maxScreenW = holdFrameLeftX - HUD_PAD * 2
  return Math.max(HUD_MIN_W, Math.min(HUD_MAX_W, maxScreenW / scale))
}

export class Ui {
  private g?: P5.Graphics
  private readonly stats: Record<StatKey, Stat> = {
    score: { label: 'Score', value: '0', bump: 0 },
    best: { label: 'Best', value: '0', bump: 0 },
    level: { label: 'Level', value: '1', bump: 0 },
    lines: { label: 'Lines', value: '0', bump: 0 }
  }
  private readonly overlay: OverlayState = { title: '', sub: '', kind: 'pause', shown: false, t: 0 }
  private readonly toasts: ToastQueueState = createToastQueue()
  /** The one-shot "Tab controls · Esc pause" hint shown at the start of a run. */
  private readonly startHint = { life: 0, appear: 0 }
  private draft = emptyDraft()
  private readonly callout: MoveCallout = {
    title: '',
    sub: '',
    b2b: 0,
    combo: 0,
    color: GOLD,
    life: 0,
    appear: 0,
    pop: 0
  }
  /** The controls legend is opt-in — Tab toggles it. `t` is its eased opacity. */
  private readonly legend = { shown: false, t: 0 }

  // --- public state setters --------------------------------------------------
  public setScore(v: number): void {
    this.set('score', v)
  }
  public setBest(v: number): void {
    this.set('best', v)
  }
  public setLevel(v: number): void {
    this.set('level', v)
  }
  public setLines(v: number): void {
    this.set('lines', v)
  }

  private set(key: StatKey, value: number): void {
    const s = this.stats[key]
    const str = String(value)
    if (s.value === str) return
    s.value = str
    s.bump = 1
  }

  public showOverlay(title: string, sub: string, kind: 'pause' | 'over'): void {
    this.overlay.title = title
    this.overlay.sub = sub
    this.overlay.kind = kind
    this.overlay.shown = true
  }
  public hideOverlay(): void {
    this.overlay.shown = false
  }
  public showBanner(text: string): void {
    pushToast(this.toasts, text, { tone: 'accent' })
  }

  /**
   * Show the brief "Tab controls · Esc pause" hint. Called once per run (from
   * `onStart`), so it never repeats mid-run. With `persistentHints` on it
   * simply doesn't fade — `Infinity - dt` stays `Infinity`, so no branch is
   * needed in `update()`.
   */
  public showStartHint(): void {
    this.startHint.life = settings.persistentHints ? Infinity : START_HINT_HOLD
  }

  /** Dismiss the start hint early — called when the full controls legend opens. */
  public dismissStartHint(): void {
    this.startHint.life = 0
  }

  public announceSpin(name: PieceName, lines: number): void {
    this.draft.spin = name
    this.draft.lines = lines
    this.draft.dirty = true
  }

  public announceClear(lines: number): void {
    if (lines < 3) return
    if (this.draft.lines < 0) this.draft.lines = lines
    this.draft.dirty = true
  }

  public announceB2B(chain: number): void {
    this.draft.b2b = chain
    this.draft.dirty = true
  }

  public announceCombo(combo: number): void {
    this.draft.combo = combo
    this.draft.dirty = true
  }

  public announcePerfectClear(lines: number): void {
    this.draft.perfectClear = true
    if (this.draft.lines < 0) this.draft.lines = lines
    this.draft.dirty = true
  }

  public clearMove(): void {
    this.draft = emptyDraft()
    this.callout.life = 0
    this.callout.appear = 0
    this.callout.pop = 0
    this.callout.title = ''
  }

  /** Show/hide the controls legend under the well. */
  public toggleLegend(): void {
    this.legend.shown = !this.legend.shown
  }

  // --- per-frame animation ---------------------------------------------------
  public update(dt: number): void {
    if (this.draft.dirty) this.flushDraft()

    for (const key of Object.keys(this.stats) as StatKey[]) {
      const s = this.stats[key]
      if (s.bump > 0) s.bump = Math.max(0, s.bump - dt * 3.6)
    }
    const target = this.overlay.shown ? 1 : 0
    this.overlay.t += (target - this.overlay.t) * (1 - Math.exp(-dt * 11))
    if (!this.overlay.shown && this.overlay.t < 0.004) this.overlay.t = 0

    const legendTarget = this.legend.shown ? 1 : 0
    this.legend.t += (legendTarget - this.legend.t) * (1 - Math.exp(-dt * 14))
    if (!this.legend.shown && this.legend.t < 0.004) this.legend.t = 0

    updateToastQueue(this.toasts, dt)

    if (this.startHint.life > 0) {
      this.startHint.life -= dt
      this.startHint.appear = Math.min(1, this.startHint.appear + dt * 6)
    } else {
      this.startHint.appear = Math.max(0, this.startHint.appear - dt * 6)
    }

    if (this.callout.life > 0) {
      this.callout.life -= dt
      this.callout.appear = Math.min(1, this.callout.appear + dt * 8)
    } else {
      this.callout.appear = Math.max(0, this.callout.appear - dt * 5)
    }
    if (this.callout.pop > 0) this.callout.pop = Math.max(0, this.callout.pop - dt * 2.8)
  }

  private flushDraft(): void {
    const { spin, lines, b2b, combo, perfectClear } = this.draft
    this.draft = emptyDraft()

    const special = perfectClear || !!spin || lines >= 3 || b2b > 0 || combo > 0
    if (!special) return

    let title = ''
    let sub = ''
    let color: RGB
    let badgeB2b = b2b
    let badgeCombo = combo

    if (perfectClear) {
      title = 'ALL CLEAR'
      sub = spin ? `${spin}-SPIN` : lines > 0 ? (LINE_LABELS[lines] ?? '') : ''
      color = GOLD
    } else if (spin) {
      title = `${spin}-SPIN`
      sub = lines > 0 ? (LINE_LABELS[lines] ?? '') : ''
      color = PALETTE[spin].glow
    } else if (lines >= 4) {
      title = 'TETRIS'
      color = GOLD
    } else if (lines === 3) {
      title = 'TRIPLE'
      color = mix(CYAN, FG, 0.15)
    } else if (b2b > 0) {
      title = 'B2B'
      sub = `×${b2b}`
      color = GOLD
      badgeB2b = 0
    } else {
      title = 'COMBO'
      sub = `×${combo}`
      color = CYAN
      badgeCombo = 0
    }

    this.callout.title = title
    this.callout.sub = sub
    this.callout.b2b = badgeB2b
    this.callout.combo = badgeCombo
    this.callout.color = color
    this.callout.life = 2.2
    this.callout.appear = Math.max(this.callout.appear, 0.15)
    this.callout.pop = 1
  }

  // --- compositing -----------------------------------------------------------
  /** Render the chrome into the buffer and composite it over the WEBGL scene. */
  public paint(p: P5): void {
    const w = p.width
    const h = p.height
    const g = (this.g = ensureBuffer(p, this.g, w, h))

    g.clear(0, 0, 0, 0)
    g.textFont(MONO)
    this.drawVignette(g, w, h)
    this.drawHud(g, p)
    this.drawSidePanelLabels(g, p)
    this.drawStartHint(g, p)
    this.drawLegend(g, p)
    this.drawOverlay(g, p)
    drawToast(g, w, this.toasts.active, UI.accent, h * 0.34)
    setTracking(g, 0) // don't leak spacing into the next frame

    composite(p, g)
  }

  // --- pieces of chrome ------------------------------------------------------
  /** Soft radial vignette over the whole scene (was the CSS `body::after`). */
  private drawVignette(g: P5.Graphics, w: number, h: number): void {
    const dc = g.drawingContext as CanvasRenderingContext2D
    const cx = w / 2
    const cy = h / 2
    const r = (Math.hypot(w, h) / 2) * 1.1
    const grad = dc.createRadialGradient(cx, cy, r * 0.55, cx, cy, r)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
    g.push()
    dc.fillStyle = grad
    dc.fillRect(0, 0, w, h)
    g.pop()
  }

  /** One compact panel — Score/Level primary, Best/Lines secondary — near the well. */
  private drawHud(g: P5.Graphics, p: P5): void {
    const accent = UI.accent
    const scale = chromeScale(p)
    const w = hudLocalWidth(p, scale)

    g.push()
    g.translate(HUD_PAD, chromeTop())
    g.scale(scale)

    panel(g, 0, 0, w, HUD_PANEL_H, { r: 12, fill: PANEL, fillA: 214, strokeA: 64 })

    const innerW = w - HUD_PAD_IN * 2
    let ry = HUD_PAD_IN
    ry = this.drawPrimaryStat(g, this.stats.score, HUD_PAD_IN, ry, innerW, accent) + HUD_ROW_GAP
    ry = this.drawPrimaryStat(g, this.stats.level, HUD_PAD_IN, ry, innerW, accent) + HUD_ROW_GAP
    this.drawSecondaryRow(g, HUD_PAD_IN, ry, innerW, accent)

    this.drawMoveCallout(g, 0, HUD_PANEL_H + HUD_CALLOUT_GAP, w)
    g.pop()
  }

  /** A large Score/Level row. Returns the y just past it, so callers can stack rows. */
  private drawPrimaryStat(g: P5.Graphics, s: Stat, x: number, y: number, w: number, accent: RGB): number {
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 128)
    g.textAlign(g.LEFT, g.TOP)
    g.textSize(10)
    setTracking(g, 2.2)
    g.text(s.label.toUpperCase(), x, y)
    g.pop()

    const b = hump(s.bump)
    const col = mix(FG, accent, b)
    const scale = 1 + (settings.reducedMotionActive ? 0 : b * PULSE_SCALE_PRIMARY)
    g.push()
    g.noStroke()
    g.fill(col[0], col[1], col[2])
    g.textAlign(g.LEFT, g.BASELINE)
    g.textSize(22)
    setTracking(g, 0)
    const value = truncate(g, s.value, w)
    const dc = g.drawingContext as CanvasRenderingContext2D
    dc.shadowColor = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.35)`
    dc.shadowBlur = 12
    g.translate(x, y + HUD_PRIMARY_ROW_H - 4)
    g.scale(scale)
    g.text(value, 0, 0)
    g.pop()

    return y + HUD_PRIMARY_ROW_H
  }

  /** Best + Lines, side by side, dimmer and smaller — secondary information. */
  private drawSecondaryRow(g: P5.Graphics, x: number, y: number, w: number, accent: RGB): void {
    const colGap = 12
    const colW = (w - colGap) / 2
    this.drawSecondaryStat(g, this.stats.best, x, y, colW, accent)
    this.drawSecondaryStat(g, this.stats.lines, x + colW + colGap, y, colW, accent)
  }

  private drawSecondaryStat(g: P5.Graphics, s: Stat, x: number, y: number, w: number, accent: RGB): void {
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 105)
    g.textAlign(g.LEFT, g.TOP)
    g.textSize(9)
    setTracking(g, 1.8)
    g.text(s.label.toUpperCase(), x, y)
    g.pop()

    const b = hump(s.bump)
    const col = mix(FG, accent, b)
    const scale = 1 + (settings.reducedMotionActive ? 0 : b * PULSE_SCALE_SECONDARY)
    g.push()
    g.noStroke()
    g.fill(col[0], col[1], col[2], 220)
    g.textAlign(g.LEFT, g.TOP)
    g.textSize(12)
    setTracking(g, 0)
    const value = truncate(g, s.value, w)
    g.translate(x, y + 9)
    g.scale(scale)
    g.text(value, 0, 0)
    g.pop()
  }

  /**
   * "HOLD" / "NEXT" labels above the WEBGL side panels. The panels live in
   * world space (see `sketch.ts`); this projects their approximate screen
   * position with the same `fitScale` the camera uses, ignoring the small
   * tilt/sway — imperceptible for a label a few px above a panel.
   */
  private drawSidePanelLabels(g: P5.Graphics, p: P5): void {
    const s = fitScale(p)
    const cx = p.width / 2
    const cy = p.height / 2
    const labelY = cy + sidePanelTop() * s - SIDE_PANEL_HALF * s - Math.max(10, SIDE_PANEL_LABEL_GAP * s)
    const holdX = cx - sidePanelX() * s
    const nextX = cx + sidePanelX() * s
    // HOLD is the one actionable slot — accent-tinted; NEXT is a passive queue.
    panelLabel(g, 'HOLD', holdX, labelY, UI.accent, 0.9)
    panelLabel(g, 'NEXT', nextX, labelY, FG, 0.55)
  }

  /** Non-blocking, one-shot control hint shown at the start of a run. */
  private drawStartHint(g: P5.Graphics, p: P5): void {
    const a = smooth(this.startHint.appear)
    if (a <= 0.004) return
    const scale = chromeScale(p)
    g.textSize(11)
    setTracking(g, 1.4)
    const tw = g.textWidth(START_HINT_TEXT)
    const bw = tw + 36
    const bh = 30

    g.push()
    g.translate(p.width / 2, chromeTop() + bh / 2)
    g.scale(scale)
    g.noStroke()
    g.fill(BAR[0], BAR[1], BAR[2], 160 * a)
    g.rect(-bw / 2, -bh / 2, bw, bh, bh / 2)
    g.fill(FG[0], FG[1], FG[2], 205 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(11)
    setTracking(g, 1.4)
    g.text(START_HINT_TEXT, 0, 0.5)
    g.pop()
  }

  /** Special-move readout (all clear, T-spin, Tetris, B2B, combo) under the stats panel. */
  private drawMoveCallout(g: P5.Graphics, x: number, y: number, w: number): void {
    const a = smooth(this.callout.appear)
    if (a <= 0.004 || !this.callout.title) return

    const c = this.callout
    const pop = hump(c.pop)
    const hasBadges = c.b2b > 0 || c.combo > 0
    let h = 52
    if (c.sub && hasBadges) h = 86
    else if (c.sub) h = 68
    else if (hasBadges) h = 72

    g.push()
    g.translate(x + (1 - a) * -18, y)
    g.scale(1 + pop * 0.08)

    panel(g, 0, 0, w, h, { r: 10, fill: PANEL, fillA: 220 * a, strokeA: 70 * a })

    g.noStroke()
    g.fill(c.color[0], c.color[1], c.color[2], 255 * a)
    g.rect(0, 8, 3, h - 16, 2)

    const dc = g.drawingContext as CanvasRenderingContext2D
    g.push()
    g.noStroke()
    g.fill(c.color[0], c.color[1], c.color[2], 255 * a)
    g.textAlign(g.LEFT, g.TOP)
    g.textSize(c.title.length > 10 ? 12 : 14)
    setTracking(g, 1.4)
    dc.shadowColor = `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, ${0.55 * a})`
    dc.shadowBlur = 16 + pop * 10
    g.text(c.title, 14, 12)
    g.pop()

    if (c.sub) {
      g.noStroke()
      g.fill(FG[0], FG[1], FG[2], 210 * a)
      g.textAlign(g.LEFT, g.TOP)
      g.textSize(11)
      setTracking(g, 2)
      g.text(c.sub, 14, 34)
    }

    if (hasBadges) {
      let bx = 14
      const by = c.sub ? 54 : 36
      if (c.b2b > 0) bx = this.drawBadge(g, bx, by, `B2B ×${c.b2b}`, GOLD, a)
      if (c.combo > 0) this.drawBadge(g, bx, by, `COMBO ×${c.combo}`, CYAN, a)
    }

    g.pop()
  }

  private drawBadge(g: P5.Graphics, x: number, y: number, label: string, color: RGB, a: number): number {
    g.textSize(9)
    setTracking(g, 0.8)
    const tw = g.textWidth(label)
    const bw = tw + 10
    const bh = 16
    g.noStroke()
    g.fill(color[0], color[1], color[2], 40 * a)
    g.rect(x, y, bw, bh, 4)
    g.noFill()
    g.stroke(color[0], color[1], color[2], 160 * a)
    g.strokeWeight(1)
    g.rect(x + 0.5, y + 0.5, bw - 1, bh - 1, 4)
    g.noStroke()
    g.fill(color[0], color[1], color[2], 240 * a)
    g.textAlign(g.LEFT, g.CENTER)
    g.text(label, x + 5, y + bh / 2 + 0.5)
    return x + bw + 6
  }

  /**
   * Controls legend, built from the live key bindings — a rebind in the
   * settings screen shows up here on the very next frame. Hidden until the
   * player asks for it with Tab (see {@link toggleLegend}).
   */
  private drawLegend(g: P5.Graphics, p: P5): void {
    const a = smooth(this.legend.t)
    if (a <= 0.004) return
    const scale = chromeScale(p)
    const w = p.width
    const h = p.height
    const keyH = 18
    const kGap = 6
    const labelGap = 6
    const entryGap = 16
    const rowH = 24
    const rowGap = 6
    const padX = 16
    const padY = 9

    // Measure every entry: keycap widths + label width.
    const entries: LegendEntry[] = BINDS.flatMap((bind) => {
      const keys = settings.keysFor(bind).map(keyLabel)
      if (keys.length === 0) return []
      const label = BIND_LABELS[bind]
      const keyW = keys.map((k) => keycapWidth(g, k))
      g.textSize(11)
      setTracking(g, 0.4)
      const labelW = g.textWidth(label)
      const width = keyW.reduce((a, b) => a + b, 0) + kGap * (keys.length - 1) + labelGap + labelW
      return [{ keys, label, keyW, width }]
    })
    if (entries.length === 0) return

    // Greedily pack entries into rows that fit the window width (in local space).
    const maxRowW = w / scale - 40 - padX * 2
    const rows: LegendEntry[][] = []
    let cur: LegendEntry[] = []
    let curW = 0
    for (const e of entries) {
      const add = (cur.length ? entryGap : 0) + e.width
      if (cur.length && curW + add > maxRowW) {
        rows.push(cur)
        cur = []
        curW = 0
      }
      curW += (cur.length ? entryGap : 0) + e.width
      cur.push(e)
    }
    if (cur.length) rows.push(cur)

    const rowWidths = rows.map((r) => r.reduce((a, e) => a + e.width, 0) + entryGap * (r.length - 1))
    const containerW = Math.max(...rowWidths) + padX * 2
    const containerH = rows.length * rowH + (rows.length - 1) * rowGap + padY * 2

    // The whole legend fades and slides in as one, so `a` scales every alpha.
    g.push()
    g.translate(w / 2, h - 14)
    g.scale(scale)
    g.translate(0, settings.reducedMotionActive ? 0 : (1 - a) * 12)
    g.translate(-containerW / 2, -containerH)
    panel(g, 0, 0, containerW, containerH, {
      r: 12,
      fill: BAR,
      fillA: 140 * a,
      strokeA: 40 * a
    })

    ;(g.drawingContext as CanvasRenderingContext2D).globalAlpha = 0.82 * a
    let ry = padY
    rows.forEach((row, i) => {
      let rx = (containerW - rowWidths[i]) / 2
      for (const e of row) {
        e.keys.forEach((k, ki) => {
          const kw = e.keyW[ki]
          keycap(g, k, rx, ry + (rowH - keyH) / 2, kw, keyH)
          rx += kw + (ki < e.keys.length - 1 ? kGap : 0)
        })
        rx += labelGap
        g.noStroke()
        g.fill(FG[0], FG[1], FG[2], 230)
        g.textAlign(g.LEFT, g.CENTER)
        g.textSize(11)
        setTracking(g, 0.4)
        g.text(e.label, rx, ry + rowH / 2)
        rx += g.textWidth(e.label) + entryGap
      }
      ry += rowH + rowGap
    })
    g.pop()
  }

  private drawOverlay(g: P5.Graphics, p: P5): void {
    const a = this.overlay.t
    if (a <= 0.004) return
    const titleCol = this.overlay.kind === 'over' ? RED : UI.accent
    const rm = settings.reducedMotionActive
    const w = p.width
    const h = p.height
    const scale = chromeScale(p)

    g.push()
    g.noStroke()
    g.fill(4, 6, 12, 0.45 * 255 * a)
    g.rect(0, 0, w, h)
    g.pop()

    g.textSize(34)
    setTracking(g, 5)
    const tW = g.textWidth(this.overlay.title.toUpperCase())
    g.textSize(13)
    setTracking(g, 1)
    const sW = this.overlay.sub ? g.textWidth(this.overlay.sub) : 0
    const cardW = Math.max(tW, sW) + 92
    const cardH = this.overlay.sub ? 150 : 118

    g.push()
    g.translate(w / 2, h / 2)
    g.scale(scale * (rm ? 1 : 0.96 + 0.04 * a))
    g.translate(0, rm ? 0 : (1 - a) * 8)

    panel(g, -cardW / 2, -cardH / 2, cardW, cardH, {
      r: 16,
      fill: [16, 20, 34],
      fillA: 0.72 * 255,
      strokeA: 56
    })

    const dc = g.drawingContext as CanvasRenderingContext2D
    g.push()
    g.noStroke()
    g.fill(titleCol[0], titleCol[1], titleCol[2], 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(34)
    setTracking(g, 5)
    dc.shadowColor = `rgba(${titleCol[0]}, ${titleCol[1]}, ${titleCol[2]}, ${0.5 * a})`
    dc.shadowBlur = 22
    // Nudge left by half the trailing letter-spacing so it stays centred.
    g.text(this.overlay.title.toUpperCase(), -2.5, this.overlay.sub ? -18 : 0)
    g.pop()

    if (this.overlay.sub) {
      g.noStroke()
      g.fill(FG[0], FG[1], FG[2], 0.78 * 255 * a)
      g.textAlign(g.CENTER, g.CENTER)
      g.textSize(13)
      setTracking(g, 1)
      g.text(this.overlay.sub, -0.5, 26)
    }
    g.pop()
  }
}
