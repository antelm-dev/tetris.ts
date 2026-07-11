import type P5 from 'p5'
import { mix, type RGB } from '../core/color'
import { smooth } from '../core/ease'
import { BIND_LABELS, BINDS, isBindable, keyLabel, type Bind } from '../config/keymap'
import { settings } from '../config/settings'
import { PALETTE, THEMES, UI } from '../config/themes'
import type { PieceName } from '../engine'
import { composite, ensureBuffer, FG, keycap, keycapWidth, MONO, panel, setTracking } from './widgets'

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

type RowId = 'solo' | 'multiplayer' | 'settings' | 'quit' | 'theme' | 'reset' | 'back' | `bind:${Bind}`

interface Row {
  id: RowId
  label: string
  /** How the right-hand side of the row renders and what Enter/←/→ do. */
  kind: 'action' | 'theme' | 'bind'
  disabled?: boolean
  /** Small pill on the right — used for the "soon" marker on multiplayer. */
  tag?: string
  bind?: Bind
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

const DIM: RGB = [4, 6, 12]
const SLOT_ORDER: PieceName[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

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
  /** Hit boxes recorded while painting, so the mouse can target the same rows. */
  private hits: { row: Row; rect: Rect }[] = []
  private themeArrows?: { prev: Rect; next: Rect }

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
    this.clock += dt
    const target = this.open ? 1 : 0
    this.t += (target - this.t) * (1 - Math.exp(-dt * 12))
    if (!this.open && this.t < 0.004) this.t = 0
    this.deny = Math.max(0, this.deny - dt * 3)
  }

  // --- model -----------------------------------------------------------------
  private entries(): Entry[] {
    if (this.screen === 'main') {
      const rows: Row[] = [
        { id: 'solo', label: 'Solo', kind: 'action' },
        { id: 'multiplayer', label: 'Multiplayer', kind: 'action', disabled: true, tag: 'Soon' },
        { id: 'settings', label: 'Settings', kind: 'action' }
      ]
      if (this.handlers.onQuit) rows.push({ id: 'quit', label: 'Quit', kind: 'action' })
      return rows.map((row) => ({ kind: 'row', row }))
    }

    return [
      { kind: 'heading', label: 'Theme' },
      { kind: 'row', row: { id: 'theme', label: 'Palette', kind: 'theme' } },
      { kind: 'gap', h: 8 },
      { kind: 'heading', label: 'Controls' },
      ...BINDS.map(
        (bind): Entry => ({
          kind: 'row',
          row: { id: `bind:${bind}`, label: BIND_LABELS[bind], kind: 'bind', bind }
        })
      ),
      { kind: 'gap', h: 8 },
      { kind: 'row', row: { id: 'reset', label: 'Reset to defaults', kind: 'action' } },
      { kind: 'row', row: { id: 'back', label: 'Back', kind: 'action' } }
    ]
  }

  private rows(): Row[] {
    return this.entries().flatMap((e) => (e.kind === 'row' ? [e.row] : []))
  }

  /** Move the focus by `step`, skipping disabled rows and wrapping around. */
  private move(step: number): void {
    const rows = this.rows()
    const n = rows.length
    const next = rows.map((_, i) => (((this.index + step * (i + 1)) % n) + n) % n).find((i) => !rows[i].disabled)
    if (next !== undefined) this.index = next
  }

  private cycleTheme(step: number): void {
    const ids = THEMES.map((t) => t.id)
    const at = ids.indexOf(settings.theme.id)
    settings.setTheme(ids[(at + step + ids.length) % ids.length])
  }

  private activate(row: Row): void {
    if (row.disabled) {
      this.deny = 1
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
        break
      case 'quit':
        this.handlers.onQuit?.()
        break
      case 'theme':
        this.cycleTheme(1)
        break
      case 'reset':
        settings.reset()
        break
      case 'back':
        this.back()
        break
      default:
        if (row.bind) this.capturing = row.bind
    }
  }

  private back(): void {
    if (this.screen !== 'settings') return
    this.screen = 'main'
    // Land back on the row that opened this screen.
    this.index = this.rows().findIndex((r) => r.id === 'settings')
  }

  // --- keyboard --------------------------------------------------------------
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return

    if (this.capturing) {
      e.preventDefault()
      if (e.key !== 'Escape' && isBindable(e.key)) settings.bind(this.capturing, e.key)
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
        if (row?.kind === 'theme') this.cycleTheme(-1)
        break
      case 'ArrowRight':
        if (row?.kind === 'theme') this.cycleTheme(1)
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
    const arrows = this.themeArrows
    if (arrows && inside(arrows.prev, x, y)) {
      this.cycleTheme(-1)
      return
    }
    if (arrows && inside(arrows.next, x, y)) {
      this.cycleTheme(1)
      return
    }
    const hit = this.hits.find((h) => inside(h.rect, x, y))
    if (hit) this.activate(hit.row)
  }

  // --- painting --------------------------------------------------------------
  public paint(p: P5): void {
    if (this.t <= 0.004) return
    const w = p.width
    const h = p.height
    const g = (this.g = ensureBuffer(p, this.g, w, h))
    const a = smooth(this.t)

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
    const cardH = TITLE_H + bodyH + FOOTER_H
    // Shrink the whole card rather than scrolling it when the window is short.
    const s = Math.min(1, (h - 90) / cardH, (w - 40) / CARD_W)
    const originX = w / 2 - (CARD_W * s) / 2
    const originY = h / 2 - (cardH * s) / 2 + (1 - a) * 10

    this.hits = []
    this.themeArrows = undefined

    g.push()
    g.translate(originX, originY)
    g.scale(s)

    panel(g, 0, 0, CARD_W, cardH, { r: 18, fill: [12, 15, 26], fillA: 0.86 * 255 * a, strokeA: 60 * a })
    this.drawTitle(g, a)

    let y = TITLE_H
    const focusedId = this.rows()[this.index]?.id
    const place = { originX, originY, s }
    for (const entry of entries) {
      if (entry.kind === 'heading') this.drawHeading(g, entry.label, y, HEADING_H, a)
      if (entry.kind === 'row') {
        this.drawRow(g, entry.row, y, entry.row.id === focusedId, a)
        this.record(entry.row, y, place)
      }
      y += entryHeight(entry) + ROW_GAP
    }

    this.drawFooter(g, cardH, a)
    g.pop()

    setTracking(g, 0) // don't leak spacing into the next frame
    composite(p, g)
  }

  /**
   * Remember where a row landed, in *window* coordinates — the card is drawn
   * through a translate+scale, and the mouse position isn't.
   */
  private record(row: Row, y: number, place: { originX: number; originY: number; s: number }): void {
    const { originX, originY, s } = place
    this.hits.push({
      row,
      rect: { x: originX + PAD_X * s, y: originY + y * s, w: (CARD_W - PAD_X * 2) * s, h: ROW_H * s }
    })
    if (row.kind !== 'theme') return
    const cy = originY + (y + ROW_H / 2) * s
    const box = 26 * s
    const arrow = (dx: number): Rect => ({
      x: originX + (CARD_W - PAD_X - dx) * s - box / 2,
      y: cy - box / 2,
      w: box,
      h: box
    })
    this.themeArrows = { prev: arrow(190), next: arrow(8) }
  }

  private drawTitle(g: P5.Graphics, a: number): void {
    const accent = UI.accent
    const dc = g.drawingContext as CanvasRenderingContext2D
    const title = this.screen === 'main' ? 'TETRIS.TS' : 'SETTINGS'
    const sub = this.screen === 'main' ? 'A 3D take on the classic' : 'Theme and controls, saved automatically'

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

    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 0.5 * 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(11)
    setTracking(g, 1.4)
    g.text(sub, CARD_W / 2 - 0.7, 74)
    g.pop()
  }

  private drawHeading(g: P5.Graphics, label: string, y: number, h: number, a: number): void {
    const text = label.toUpperCase()
    const cy = y + h / 2
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 0.4 * 255 * a)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(10)
    setTracking(g, 2.2)
    g.text(text, PAD_X, cy)
    // Rule filling the space to the right of the label — measured while the
    // heading's own text style is still applied.
    const tx = PAD_X + g.textWidth(text) + 22
    g.stroke(120, 140, 200, 34 * a)
    g.strokeWeight(1)
    g.line(tx, cy, CARD_W - PAD_X, cy)
    g.pop()
  }

  private drawRow(g: P5.Graphics, row: Row, y: number, focused: boolean, a: number): void {
    const x = PAD_X
    const w = CARD_W - PAD_X * 2
    const accent = UI.accent
    const dim = row.disabled ? 0.38 : 1
    const capturing = this.capturing && row.bind === this.capturing

    if (focused) {
      // A soft accent wash + a bright left notch marks the focused row. On a
      // disabled row it turns red and shudders, so a rejected Enter is visible.
      const denied = this.deny > 0 && row.disabled
      const glow = 0.5 + 0.5 * Math.sin(this.clock * 3)
      const hl: RGB = denied ? [228, 92, 104] : accent
      const shake = denied ? Math.sin(this.clock * 60) * 3 * this.deny : 0
      g.push()
      g.translate(shake, 0)
      panel(g, x, y, w, ROW_H, {
        r: 10,
        fill: hl,
        fillA: (denied ? 40 : 20 + glow * 10) * a,
        strokeA: (denied ? 90 : 50) * a
      })
      g.noStroke()
      g.fill(hl[0], hl[1], hl[2], 255 * a)
      g.rect(x + 1, y + 9, 3, ROW_H - 18, 2)
      g.pop()
    }

    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 235 * a * dim)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(row.kind === 'action' ? 15 : 13)
    setTracking(g, row.kind === 'action' ? 1.2 : 0.4)
    g.text(row.label, x + 16, y + ROW_H / 2)
    g.pop()

    if (row.tag) this.drawTag(g, row.tag, x + w - 12, y + ROW_H / 2, a)
    if (row.kind === 'theme') this.drawThemeValue(g, x + w, y, a)
    if (row.kind === 'bind' && row.bind) this.drawBindValue(g, row.bind, x + w, y, a, !!capturing)
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

  /** `‹ Name ›` plus a swatch strip of the theme's seven piece colours. */
  private drawThemeValue(g: P5.Graphics, right: number, y: number, a: number): void {
    const cy = y + ROW_H / 2
    const theme = settings.theme
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
        : '↑↓ Navigate   ·   ←→ Change theme   ·   Enter Rebind   ·   Esc Back'
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
