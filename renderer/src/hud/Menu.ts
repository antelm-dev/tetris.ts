import type P5 from 'p5'
import { mix, type RGB } from '../core/color'
import { clamp01, smooth } from '../core/ease'
import { BIND_GROUPS, BIND_LABELS, isBindable, keyLabel, type Bind } from '../config/keymap'
import { settings, type ReducedMotionPref } from '../config/settings'
import { PALETTE, THEMES, UI } from '../config/themes'
import type { PieceName } from '../engine'
import {
  actionRowBackground,
  clipRect,
  composite,
  createScrollState,
  createToastQueue,
  DISABLED_DIM,
  drawScrollIndicator,
  drawToast,
  ensureBuffer,
  FG,
  focusRing,
  keycap,
  keycapWidth,
  MONO,
  panel,
  pushToast,
  RED,
  scrollBy,
  scrollIntoView,
  sectionLabel,
  setTracking,
  unclip,
  updateScroll,
  updateToastQueue,
  type ScrollState,
  type ToastQueueState
} from './widgets'

/**
 * The front-end menu, drawn with p5 into the same kind of off-screen 2D buffer
 * as the in-game HUD (see `Ui.ts`) and composited over the live 3D scene — so
 * the board and its evolving backdrop keep animating behind it, and a theme
 * change previews itself instantly on the blocks in the background.
 *
 * Driven by the keyboard (↑/↓ to move, ←/→ to cycle a value, Enter to select,
 * Esc to go back) and by the mouse; {@link pointer} and {@link click} are fed
 * from the sketch's mouse state rather than through DOM listeners, because the
 * canvas is the only element under the cursor anyway.
 */

type Screen = 'main' | 'settings'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type RowId =
  | 'solo'
  | 'multiplayer'
  | 'settings'
  | 'quit'
  | 'theme'
  | 'reset'
  | 'back'
  | `bind:${Bind}`
  | 'comfort:reducedMotion'
  | 'comfort:screenShake'
  | 'comfort:effects'
  | 'comfort:hints'

interface Row {
  id: RowId
  label: string
  /** How the right-hand side of the row renders and what Enter/←/→ do. */
  kind: 'action' | 'theme' | 'bind' | 'stepper' | 'toggle'
  disabled?: boolean
  /** Small pill on the right — used for the "soon" marker on multiplayer. */
  tag?: string
  bind?: Bind
  /** `primary` reads as the main CTA (Solo); `secondary` recedes (Multiplayer). */
  emphasis?: 'primary' | 'secondary'
}

type Entry = { kind: 'heading'; label: string } | { kind: 'gap'; h: number } | { kind: 'row'; row: Row }

export interface MenuHandlers {
  /** Start (or restart) a single-player game. */
  onSolo: () => void
  /** Quit the app; the row is only shown when this is provided. */
  onQuit?: () => void
}

const CARD_W = 500
const PAD_X = 30
const ROW_H = 42
const ROW_GAP = 6
const HEADING_H = 30
const TITLE_H = 104
const FOOTER_H = 44
/** Outer margin kept clear around the card, split from the old combined shrink-to-fit formula. */
const CARD_MARGIN_X = 20
const CARD_MARGIN_Y = 45
/** Never show fewer than this many rows' worth of the settings list at once. */
const MIN_VIEWPORT_H = ROW_H * 3
const WHEEL_STEP = 0.5
const INTENSITY_STEP = 0.1
const RESET_CONFIRM_WINDOW = 4
const PRIMARY_TEXT_SIZE = 17
const PRIMARY_IDLE_WASH_A = 26
const PRIMARY_IDLE_STROKE_A = 70
const TOAST_ANCHOR_Y = 54
const SCROLL_INDICATOR_X = CARD_W - 14

const DIM: RGB = [4, 6, 12]
const SLOT_ORDER: PieceName[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

function reducedMotionLabel(pref: ReducedMotionPref): string {
  if (pref === 'auto') return 'Auto'
  return pref === 'on' ? 'On' : 'Off'
}

export class Menu {
  private g?: P5.Graphics
  private screen: Screen = 'main'
  private index = 0
  /** The action currently awaiting a key press, if a rebind is in progress. */
  private capturing?: Bind
  private open = false
  private t = 0 // eased presence, 0 → 1
  private clock = 0
  /** Decays 1 → 0 on a rejected input (a disabled row), driving a red nudge. */
  private deny = 0
  /** `clock` value the reset row's confirm-window expires at; 0 when unarmed. */
  private resetArmedUntil = 0
  /** Cached from the last `update(dt)`, since `paint()` needs it but takes no `dt` of its own. */
  private lastDt = 0
  private readonly scroll: ScrollState = createScrollState()
  private readonly toasts: ToastQueueState = createToastQueue()
  /** Hit boxes recorded while painting, so the mouse can target the same rows. */
  private hits: { row: Row; rect: Rect }[] = []
  /** `‹›` hit boxes for every value-adjustable row on screen (theme, steppers). */
  private valueArrows: { id: RowId; prev: Rect; next: Rect }[] = []

  constructor(private readonly handlers: MenuHandlers) {}

  public get isOpen(): boolean {
    return this.open
  }

  public show(): void {
    this.open = true
    this.screen = 'main'
    this.index = 0
    this.capturing = undefined
    window.addEventListener('keydown', this.onKeyDown)
  }

  public hide(): void {
    this.open = false
    this.capturing = undefined
    window.removeEventListener('keydown', this.onKeyDown)
  }

  public update(dt: number): void {
    this.lastDt = dt
    this.clock += dt
    const target = this.open ? 1 : 0
    this.t += (target - this.t) * (1 - Math.exp(-dt * 12))
    if (!this.open && this.t < 0.004) this.t = 0
    this.deny = Math.max(0, this.deny - dt * 3)
    updateToastQueue(this.toasts, dt)
  }

  // --- model -----------------------------------------------------------------
  private entries(): Entry[] {
    if (this.screen === 'main') {
      const rows: Row[] = [
        { id: 'solo', label: 'Solo', kind: 'action', emphasis: 'primary' },
        { id: 'multiplayer', label: 'Multiplayer', kind: 'action', disabled: true, tag: 'Soon', emphasis: 'secondary' },
        { id: 'settings', label: 'Settings', kind: 'action' }
      ]
      if (this.handlers.onQuit) rows.push({ id: 'quit', label: 'Quit', kind: 'action' })
      return rows.map((row) => ({ kind: 'row', row }))
    }

    const controlRows: Entry[] = []
    for (const group of BIND_GROUPS) {
      controlRows.push({ kind: 'heading', label: group.label })
      for (const bind of group.binds) {
        controlRows.push({ kind: 'row', row: { id: `bind:${bind}`, label: BIND_LABELS[bind], kind: 'bind', bind } })
      }
    }

    return [
      { kind: 'heading', label: 'Theme' },
      { kind: 'row', row: { id: 'theme', label: 'Palette', kind: 'theme' } },
      { kind: 'gap', h: 8 },
      ...controlRows,
      { kind: 'gap', h: 8 },
      { kind: 'heading', label: 'Comfort' },
      { kind: 'row', row: { id: 'comfort:reducedMotion', label: 'Reduced motion', kind: 'stepper' } },
      { kind: 'row', row: { id: 'comfort:screenShake', label: 'Screen shake', kind: 'stepper' } },
      { kind: 'row', row: { id: 'comfort:effects', label: 'Effects', kind: 'stepper' } },
      { kind: 'row', row: { id: 'comfort:hints', label: 'Persistent hints', kind: 'toggle' } },
      { kind: 'gap', h: 8 },
      {
        kind: 'row',
        row: {
          id: 'reset',
          label: this.resetArmed() ? 'Confirm reset? · Enter again' : 'Reset to defaults',
          kind: 'action'
        }
      },
      { kind: 'row', row: { id: 'back', label: 'Back', kind: 'action' } }
    ]
  }

  private rows(): Row[] {
    return this.entries().flatMap((e) => (e.kind === 'row' ? [e.row] : []))
  }

  private resetArmed(): boolean {
    return this.resetArmedUntil > this.clock
  }

  /** Move the focus by `step`, skipping disabled rows and wrapping around. */
  private move(step: number): void {
    const rows = this.rows()
    const n = rows.length
    const next = rows.map((_, i) => (((this.index + step * (i + 1)) % n) + n) % n).find((i) => !rows[i].disabled)
    if (next !== undefined) this.index = next
    this.resetArmedUntil = 0
    this.scrollToFocused()
  }

  /** Keep the keyboard-focused row inside the scrollable viewport. */
  private scrollToFocused(): void {
    const id = this.rows()[this.index]?.id
    if (id === undefined) return
    let y = 0
    for (const entry of this.entries()) {
      if (entry.kind === 'row' && entry.row.id === id) {
        scrollIntoView(this.scroll, y, ROW_H)
        return
      }
      y += entryHeight(entry) + ROW_GAP
    }
  }

  private cycleTheme(step: number): void {
    const ids = THEMES.map((t) => t.id)
    const at = ids.indexOf(settings.theme.id)
    settings.setTheme(ids[(at + step + ids.length) % ids.length])
    pushToast(this.toasts, `Theme: ${settings.theme.name}`)
  }

  private cycleReducedMotion(step: number): void {
    const order: ReducedMotionPref[] = ['auto', 'on', 'off']
    const at = order.indexOf(settings.reducedMotion)
    const next = order[(at + step + order.length) % order.length]
    settings.setReducedMotion(next)
    pushToast(this.toasts, `Reduced motion: ${reducedMotionLabel(next)}`)
  }

  private adjustIntensity(kind: 'screenShake' | 'effects', step: number): void {
    const delta = step * INTENSITY_STEP
    if (kind === 'screenShake') {
      const v = clamp01(settings.screenShakeIntensity + delta)
      settings.setScreenShakeIntensity(v)
      pushToast(this.toasts, `Screen shake: ${Math.round(v * 100)}%`)
    } else {
      const v = clamp01(settings.effectsIntensity + delta)
      settings.setEffectsIntensity(v)
      pushToast(this.toasts, `Effects: ${Math.round(v * 100)}%`)
    }
  }

  /** Dispatch a `‹›` adjustment for a theme or comfort-stepper row. */
  private adjust(row: Row, step: number): void {
    if (row.id === 'theme') this.cycleTheme(step)
    else if (row.id === 'comfort:reducedMotion') this.cycleReducedMotion(step)
    else if (row.id === 'comfort:screenShake') this.adjustIntensity('screenShake', step)
    else if (row.id === 'comfort:effects') this.adjustIntensity('effects', step)
  }

  private toggleHints(): void {
    settings.setPersistentHints(!settings.persistentHints)
    pushToast(this.toasts, `Persistent hints: ${settings.persistentHints ? 'On' : 'Off'}`)
  }

  private activateReset(): void {
    if (this.resetArmed()) {
      settings.reset()
      this.resetArmedUntil = 0
      pushToast(this.toasts, 'Settings reset to defaults')
    } else {
      this.resetArmedUntil = this.clock + RESET_CONFIRM_WINDOW
    }
  }

  private activate(row: Row): void {
    if (row.disabled) {
      this.deny = 1
      return
    }
    if (row.id !== 'reset') this.resetArmedUntil = 0

    if (row.kind === 'theme' || row.kind === 'stepper') {
      this.adjust(row, 1)
      return
    }
    if (row.kind === 'toggle') {
      this.toggleHints()
      return
    }
    if (row.kind === 'bind') {
      this.capturing = row.bind
      return
    }

    switch (row.id) {
      case 'solo':
        this.hide()
        this.handlers.onSolo()
        break
      case 'settings':
        this.screen = 'settings'
        this.index = 0
        this.scroll.offset = 0
        this.scroll.target = 0
        break
      case 'quit':
        this.handlers.onQuit?.()
        break
      case 'reset':
        this.activateReset()
        break
      case 'back':
        this.back()
        break
    }
  }

  private back(): void {
    if (this.screen !== 'settings') return
    this.screen = 'main'
    this.resetArmedUntil = 0
    this.scroll.offset = 0
    this.scroll.target = 0
    // Land back on the row that opened this screen.
    this.index = this.rows().findIndex((r) => r.id === 'settings')
  }

  // --- keyboard --------------------------------------------------------------
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return

    if (this.capturing) {
      e.preventDefault()
      if (e.key !== 'Escape' && isBindable(e.key)) {
        const bind = this.capturing
        const { stolenFrom } = settings.bind(bind, e.key)
        const label = settings.keysFor(bind).map(keyLabel).join(' / ')
        pushToast(this.toasts, `${BIND_LABELS[bind]}: ${label}`, {
          sub: stolenFrom ? `Replaced ${BIND_LABELS[stolenFrom]}` : undefined
        })
      }
      this.capturing = undefined
      return
    }

    const rows = this.rows()
    const row = rows[this.index]
    switch (e.key) {
      case 'ArrowUp':
        this.move(-1)
        break
      case 'ArrowDown':
        this.move(1)
        break
      case 'ArrowLeft':
        if (row && (row.kind === 'theme' || row.kind === 'stepper')) this.adjust(row, -1)
        break
      case 'ArrowRight':
        if (row && (row.kind === 'theme' || row.kind === 'stepper')) this.adjust(row, 1)
        break
      case 'Enter':
      case ' ':
        if (row) this.activate(row)
        break
      case 'Escape':
        this.back()
        break
      default:
        return // not ours — let it through
    }
    e.preventDefault()
  }

  // --- mouse -----------------------------------------------------------------
  /** Feed the current cursor position; hovering a row focuses it. */
  public pointer(x: number, y: number): void {
    if (!this.open) return
    const hit = this.hits.find((h) => inside(h.rect, x, y))
    if (!hit || hit.row.disabled) return
    const at = this.rows().findIndex((r) => r.id === hit.row.id)
    if (at >= 0) this.index = at
  }

  public click(x: number, y: number): void {
    if (!this.open) return
    if (this.capturing) return // a rebind only listens for keys
    for (const a of this.valueArrows) {
      const row = this.rows().find((r) => r.id === a.id)
      if (!row) continue
      if (inside(a.prev, x, y)) {
        this.adjust(row, -1)
        return
      }
      if (inside(a.next, x, y)) {
        this.adjust(row, 1)
        return
      }
    }
    const hit = this.hits.find((h) => inside(h.rect, x, y))
    if (hit) this.activate(hit.row)
  }

  /** Scroll the settings list; a no-op outside it, so it never reaches gameplay. */
  public wheel(delta: number): void {
    if (!this.open || this.screen !== 'settings') return
    scrollBy(this.scroll, delta * WHEEL_STEP)
  }

  /** What cursor `sketch.ts` should show at this window position. */
  public cursorStyle(x: number, y: number): 'pointer' | 'default' {
    if (!this.open) return 'default'
    for (const a of this.valueArrows) {
      if (inside(a.prev, x, y) || inside(a.next, x, y)) return 'pointer'
    }
    const hit = this.hits.find((h) => inside(h.rect, x, y))
    return hit && !hit.row.disabled ? 'pointer' : 'default'
  }

  // --- painting --------------------------------------------------------------
  public paint(p: P5): void {
    if (this.t <= 0.004) return
    const w = p.width
    const h = p.height
    const g = (this.g = ensureBuffer(p, this.g, w, h))
    const a = smooth(this.t)
    const rm = settings.reducedMotionActive

    g.clear(0, 0, 0, 0)
    g.textFont(MONO)

    // Dim the live scene behind the card, but never fully hide it.
    g.push()
    g.noStroke()
    g.fill(DIM[0], DIM[1], DIM[2], 0.66 * 255 * a)
    g.rect(0, 0, w, h)
    g.pop()

    const entries = this.entries()
    const bodyH = entries.reduce((acc, e) => acc + entryHeight(e) + ROW_GAP, 0) - ROW_GAP

    // Width sets the scale; height only decides how much of the body shows at
    // once — a genuinely scrollable viewport instead of shrinking the text.
    const s = Math.min(1, (w - 2 * CARD_MARGIN_X) / CARD_W)
    const availLocalH = (h - 2 * CARD_MARGIN_Y) / s
    const viewportH = Math.max(MIN_VIEWPORT_H, Math.min(availLocalH - TITLE_H - FOOTER_H, bodyH))
    const cardH = TITLE_H + viewportH + FOOTER_H
    const originX = w / 2 - (CARD_W * s) / 2
    const originY = h / 2 - (cardH * s) / 2 + (rm ? 0 : (1 - a) * 10)

    this.scroll.viewport = viewportH
    this.scroll.content = bodyH
    updateScroll(this.scroll, this.lastDt)

    this.hits = []
    this.valueArrows = []

    g.push()
    g.translate(originX, originY)
    g.scale(s)

    panel(g, 0, 0, CARD_W, cardH, { r: 18, fill: [12, 15, 26], fillA: 0.86 * 255 * a, strokeA: 60 * a })
    this.drawTitle(g, a)

    const focusedId = this.rows()[this.index]?.id
    // Rows draw inside the clip in content-local coordinates (0 = top of the
    // list); `record()` gets a place whose origin already bakes in the same
    // scroll translate, so hit rects still land in the right window position.
    const scrolledPlace = { originX, originY: originY + (TITLE_H - this.scroll.offset) * s, s }
    clipRect(g, 0, TITLE_H, CARD_W, viewportH)
    g.translate(0, TITLE_H - this.scroll.offset)

    let y = 0
    for (const entry of entries) {
      const visible = y + entryHeight(entry) >= this.scroll.offset && y <= this.scroll.offset + viewportH
      if (visible && entry.kind === 'heading') this.drawHeading(g, entry.label, y, HEADING_H, a)
      if (entry.kind === 'row') {
        if (visible) {
          this.drawRow(g, entry.row, y, entry.row.id === focusedId, a)
          this.record(entry.row, y, scrolledPlace)
        }
      }
      y += entryHeight(entry) + ROW_GAP
    }
    unclip(g)

    drawScrollIndicator(g, SCROLL_INDICATOR_X, TITLE_H, viewportH, this.scroll, UI.accent, a)
    this.drawFooter(g, cardH, a)
    g.pop()

    drawToast(
      g,
      w,
      this.toasts.active,
      UI.accent,
      document.body.classList.contains('is-fullscreen') ? 20 : TOAST_ANCHOR_Y
    )

    setTracking(g, 0) // don't leak spacing into the next frame
    composite(p, g)
  }

  /**
   * Remember where a row landed, in *window* coordinates — the card is drawn
   * through a translate+scale (and, in the scrollable region, a further
   * scroll translate baked into `place.originY`), and the mouse position isn't.
   */
  private record(row: Row, y: number, place: { originX: number; originY: number; s: number }): void {
    const { originX, originY, s } = place
    this.hits.push({
      row,
      rect: { x: originX + PAD_X * s, y: originY + y * s, w: (CARD_W - PAD_X * 2) * s, h: ROW_H * s }
    })
    if (row.kind !== 'theme' && row.kind !== 'stepper') return
    const cy = originY + (y + ROW_H / 2) * s
    const box = 26 * s
    const arrow = (dx: number): Rect => ({
      x: originX + (CARD_W - PAD_X - dx) * s - box / 2,
      y: cy - box / 2,
      w: box,
      h: box
    })
    this.valueArrows.push({ id: row.id, prev: arrow(190), next: arrow(8) })
  }

  private drawTitle(g: P5.Graphics, a: number): void {
    const accent = UI.accent
    const dc = g.drawingContext as CanvasRenderingContext2D
    const title = this.screen === 'main' ? 'TETRIS.TS' : 'SETTINGS'

    g.push()
    g.noStroke()
    g.fill(accent[0], accent[1], accent[2], 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(30)
    setTracking(g, 6)
    dc.shadowColor = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${0.45 * a})`
    dc.shadowBlur = 22
    g.text(title, CARD_W / 2 - 3, 46)
    g.pop()

    if (this.screen !== 'main') {
      g.push()
      g.noStroke()
      g.fill(FG[0], FG[1], FG[2], 0.5 * 255 * a)
      g.textAlign(g.CENTER, g.CENTER)
      g.textSize(11)
      setTracking(g, 1.4)
      g.text('Theme, controls and comfort — saved automatically', CARD_W / 2 - 0.7, 74)
      g.pop()
    }
  }

  private drawHeading(g: P5.Graphics, label: string, y: number, h: number, a: number): void {
    sectionLabel(g, label, PAD_X, y + h / 2, CARD_W - PAD_X, a)
  }

  private drawRow(g: P5.Graphics, row: Row, y: number, focused: boolean, a: number): void {
    const x = PAD_X
    const w = CARD_W - PAD_X * 2
    const accent = UI.accent
    const armed = row.id === 'reset' && this.resetArmed()
    const dim = row.disabled || row.emphasis === 'secondary' ? DISABLED_DIM : 1
    const capturing = this.capturing && row.bind === this.capturing

    if (row.emphasis === 'primary' && !focused) {
      // Always-on accent wash, even unfocused — this is the primary CTA, not
      // just another row that happens to be focusable.
      actionRowBackground(g, x, y, w, ROW_H, {
        color: accent,
        washAlpha: PRIMARY_IDLE_WASH_A * a,
        strokeAlpha: PRIMARY_IDLE_STROKE_A * a
      })
    }

    if (focused) {
      // A soft accent wash + a bright left notch marks the focused row. On a
      // disabled row it turns red and shudders, so a rejected Enter is visible;
      // an armed reset uses the same red to signal "this needs confirming."
      const denied = this.deny > 0 && row.disabled
      const warn = denied || armed
      const glow = 0.5 + 0.5 * Math.sin(this.clock * 3)
      const hl: RGB = warn ? RED : accent
      const shake = denied ? Math.sin(this.clock * 60) * 3 * this.deny : 0
      const emphasisBoost = row.emphasis === 'primary' ? 12 : 0
      g.push()
      g.translate(shake, 0)
      actionRowBackground(g, x, y, w, ROW_H, {
        color: hl,
        washAlpha: (warn ? 40 : 20 + glow * 10 + emphasisBoost) * a,
        strokeAlpha: (warn ? 90 : 50) * a,
        notchAlpha: 255 * a
      })
      focusRing(g, x, y, w, ROW_H, { color: hl, alpha: a })
      g.pop()
    }

    const labelColor = armed ? RED : FG
    g.push()
    g.noStroke()
    g.fill(labelColor[0], labelColor[1], labelColor[2], 235 * a * dim)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(row.emphasis === 'primary' ? PRIMARY_TEXT_SIZE : row.kind === 'action' ? 15 : 13)
    setTracking(g, row.kind === 'action' ? 1.2 : 0.4)
    g.text(row.label, x + 16, y + ROW_H / 2)
    g.pop()

    if (row.tag) this.drawTag(g, row.tag, x + w - 12, y + ROW_H / 2, a)
    if (row.kind === 'theme') this.drawThemeValue(g, x + w, y, a)
    if (row.kind === 'bind' && row.bind) this.drawBindValue(g, row.bind, x + w, y, a, !!capturing)
    if (row.kind === 'stepper') this.drawStepperValue(g, row, x + w, y, a)
    if (row.kind === 'toggle') this.drawToggleValue(g, row, x + w, y, a)
  }

  private drawTag(g: P5.Graphics, text: string, right: number, cy: number, a: number): void {
    g.push()
    g.textSize(9)
    setTracking(g, 1.6)
    const tw = g.textWidth(text.toUpperCase()) + 18
    const th = 18
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 22 * a)
    g.rect(right - tw, cy - th / 2, tw, th, 9)
    g.fill(FG[0], FG[1], FG[2], 130 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.text(text.toUpperCase(), right - tw / 2 - 0.8, cy)
    g.pop()
  }

  /** `‹ ›` adjust arrows shared by the theme row and every comfort stepper. */
  private drawValueArrows(g: P5.Graphics, right: number, cy: number, a: number): void {
    const arrow = (label: string, ax: number): void => {
      g.push()
      g.noStroke()
      g.fill(FG[0], FG[1], FG[2], 150 * a)
      g.textAlign(g.CENTER, g.CENTER)
      g.textSize(14)
      setTracking(g, 0)
      g.text(label, ax, cy - 1)
      g.pop()
    }
    arrow('‹', right - 190)
    arrow('›', right - 8)
  }

  /** `‹ Name ›` plus a swatch strip of the theme's seven piece colours. */
  private drawThemeValue(g: P5.Graphics, right: number, y: number, a: number): void {
    const cy = y + ROW_H / 2
    const theme = settings.theme
    this.drawValueArrows(g, right, cy, a)

    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 235 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(13)
    setTracking(g, 0.6)
    g.text(theme.name, right - 99, cy - 7)
    g.pop()

    // Swatches read from the *live* palette, which the theme change already
    // rewrote — so they always match the blocks on the board behind the menu.
    const sw = 14
    const gap = 3
    const stripW = SLOT_ORDER.length * sw + (SLOT_ORDER.length - 1) * gap
    let sx = right - 99 - stripW / 2
    g.push()
    g.noStroke()
    for (const name of SLOT_ORDER) {
      const c = mix(PALETTE[name].body, PALETTE[name].face, 0.25)
      g.fill(c[0], c[1], c[2], 255 * a)
      g.rect(sx, cy + 5, sw, 7, 2)
      sx += sw + gap
    }
    g.pop()
  }

  private stepperText(id: RowId): string {
    if (id === 'comfort:reducedMotion') return reducedMotionLabel(settings.reducedMotion)
    if (id === 'comfort:screenShake') return `${Math.round(settings.screenShakeIntensity * 100)}%`
    if (id === 'comfort:effects') return `${Math.round(settings.effectsIntensity * 100)}%`
    return ''
  }

  /** `‹ value ›` for a comfort stepper — visually distinct from theme's swatch strip and from bind keycaps. */
  private drawStepperValue(g: P5.Graphics, row: Row, right: number, y: number, a: number): void {
    const cy = y + ROW_H / 2
    this.drawValueArrows(g, right, cy, a)
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 235 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(13)
    setTracking(g, 0.6)
    g.text(this.stepperText(row.id), right - 99, cy - 0.5)
    g.pop()
  }

  /** An ON/OFF pill for a boolean comfort setting. */
  private drawToggleValue(g: P5.Graphics, row: Row, right: number, y: number, a: number): void {
    const cy = y + ROW_H / 2
    const on = row.id === 'comfort:hints' && settings.persistentHints
    const label = on ? 'ON' : 'OFF'
    const color = on ? UI.accent : FG
    g.push()
    g.textSize(11)
    setTracking(g, 1.2)
    const tw = g.textWidth(label) + 20
    const th = 20
    const bx = right - 4 - tw
    const by = cy - th / 2
    g.noStroke()
    g.fill(color[0], color[1], color[2], (on ? 50 : 18) * a)
    g.rect(bx, by, tw, th, th / 2)
    g.noFill()
    g.stroke(color[0], color[1], color[2], (on ? 160 : 60) * a)
    g.strokeWeight(1)
    g.rect(bx + 0.5, by + 0.5, tw - 1, th - 1, th / 2)
    g.noStroke()
    g.fill(color[0], color[1], color[2], 230 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.text(label, bx + tw / 2, by + th / 2 + 0.5)
    g.pop()
  }

  private drawBindValue(g: P5.Graphics, bind: Bind, right: number, y: number, a: number, capturing: boolean): void {
    const cy = y + ROW_H / 2
    if (capturing) {
      const blink = 0.55 + 0.45 * Math.sin(this.clock * 8)
      const accent = UI.accent
      g.push()
      g.noStroke()
      g.fill(accent[0], accent[1], accent[2], 255 * a * blink)
      g.textAlign(g.RIGHT, g.CENTER)
      g.textSize(11)
      setTracking(g, 1)
      g.text('Press a key…  Esc cancels', right - 4, cy)
      g.pop()
      return
    }

    const keys = settings.keysFor(bind)
    if (keys.length === 0) {
      g.push()
      g.noStroke()
      g.fill(FG[0], FG[1], FG[2], 90 * a)
      g.textAlign(g.RIGHT, g.CENTER)
      g.textSize(12)
      setTracking(g, 0)
      g.text('unbound', right - 4, cy)
      g.pop()
      return
    }

    const labels = keys.map(keyLabel)
    const widths = labels.map((l) => keycapWidth(g, l))
    const gap = 6
    const total = widths.reduce((s, v) => s + v, 0) + gap * (labels.length - 1)
    let kx = right - 4 - total
    labels.forEach((label, i) => {
      keycap(g, label, kx, cy - 9, widths[i], 18, a)
      kx += widths[i] + gap
    })
  }

  private drawFooter(g: P5.Graphics, cardH: number, a: number): void {
    const hint =
      this.screen === 'main'
        ? '↑↓ Navigate   ·   Enter Select'
        : '↑↓ Navigate   ·   ←→ Adjust   ·   Enter Select   ·   Esc Back'
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 0.42 * 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(10)
    setTracking(g, 1)
    g.text(hint, CARD_W / 2 - 0.5, cardH - FOOTER_H / 2 - 4)
    g.pop()
  }
}

function entryHeight(e: Entry): number {
  if (e.kind === 'heading') return HEADING_H
  if (e.kind === 'gap') return e.h
  return ROW_H
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}
