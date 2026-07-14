import type P5 from 'p5'
import { mix, type RGB } from '../core/color'
import { hump, smooth } from '../core/ease'
import { BIND_LABELS, BINDS, keyLabel } from '../config/keymap'
import { settings } from '../config/settings'
import { PALETTE, UI } from '../config/themes'
import type { PieceName } from '../engine'
import { BAR, composite, ensureBuffer, FG, keycap, keycapWidth, MONO, PANEL, panel, RED, setTracking } from './widgets'

/**
 * The game's chrome — score HUD, controls legend, pause/game-over overlay and
 * the notification banner — drawn entirely in p5 rather than as DOM elements.
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

interface BannerState {
  text: string
  life: number // seconds remaining before it starts fading out
  appear: number // eased presence, 0 → 1
}

/** Draft filled by spin/clear/B2B/combo hooks in one push, flushed in update. */
interface MoveDraft {
  spin?: PieceName
  lines: number
  b2b: number
  combo: number
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

const emptyDraft = (): MoveDraft => ({ lines: -1, b2b: 0, combo: 0, dirty: false })

export class Ui {
  private g?: P5.Graphics
  private readonly stats: Record<StatKey, Stat> = {
    score: { label: 'Score', value: '0', bump: 0 },
    best: { label: 'Best', value: '0', bump: 0 },
    level: { label: 'Level', value: '1', bump: 0 },
    lines: { label: 'Lines', value: '0', bump: 0 }
  }
  private readonly overlay: OverlayState = { title: '', sub: '', kind: 'pause', shown: false, t: 0 }
  private readonly banner: BannerState = { text: '', life: 0, appear: 0 }
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
    this.banner.text = text
    this.banner.life = 2.5
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

    if (this.banner.life > 0) {
      this.banner.life -= dt
      this.banner.appear = Math.min(1, this.banner.appear + dt * 6)
    } else {
      this.banner.appear = Math.max(0, this.banner.appear - dt * 6)
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
    const { spin, lines, b2b, combo } = this.draft
    this.draft = emptyDraft()

    const special = !!spin || lines >= 3 || b2b > 0 || combo > 0
    if (!special) return

    let title = ''
    let sub = ''
    let color: RGB
    let badgeB2b = b2b
    let badgeCombo = combo

    if (spin) {
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
    this.drawHud(g)
    this.drawLegend(g, w, h)
    this.drawOverlay(g, w, h)
    this.drawBanner(g, w, h)
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

  private drawHud(g: P5.Graphics): void {
    const accent = UI.accent
    const pad = 16
    const pw = 116
    const ph = 54
    const gap = 12
    let y = 50 // clears the 34px titlebar, like the old CSS
    const order: StatKey[] = ['score', 'best', 'level', 'lines']
    for (const key of order) {
      const s = this.stats[key]
      // Fairly opaque: without a CSS backdrop-blur, a translucent panel would
      // let the busy 3D scene behind bleed through and muddy the readout.
      panel(g, pad, y, pw, ph, { r: 10, fill: PANEL, fillA: 210, strokeA: 60 })

      g.push()
      g.noStroke()
      g.fill(FG[0], FG[1], FG[2], 128)
      g.textAlign(g.LEFT, g.TOP)
      g.textSize(10)
      setTracking(g, 2.2)
      g.text(s.label.toUpperCase(), pad + 14, y + 9)
      g.pop()

      const b = hump(s.bump)
      const col = mix(FG, accent, b)
      g.push()
      g.noStroke()
      g.fill(col[0], col[1], col[2])
      g.textAlign(g.LEFT, g.BASELINE)
      g.textSize(24)
      setTracking(g, 0)
      const dc = g.drawingContext as CanvasRenderingContext2D
      dc.shadowColor = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.35)`
      dc.shadowBlur = 14
      g.translate(pad + 14, y + ph - 12)
      g.scale(1 + b * 0.28)
      g.text(s.value, 0, 0)
      g.pop()

      y += ph + gap
    }

    this.drawMoveCallout(g, pad, y, pw)
  }

  /** Special-move readout (T-spin, Tetris, B2B, combo) under the stats column. */
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
  private drawLegend(g: P5.Graphics, w: number, h: number): void {
    const a = smooth(this.legend.t)
    if (a <= 0.004) return
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

    // Greedily pack entries into rows that fit the window width.
    const maxRowW = w - 40 - padX * 2
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
    const cx = w / 2
    const top = h - 14 - containerH
    const left = cx - containerW / 2

    // The whole legend fades and slides in as one, so `a` scales every alpha.
    g.push()
    g.translate(0, (1 - a) * 12)
    panel(g, left, top, containerW, containerH, {
      r: 12,
      fill: BAR,
      fillA: 140 * a,
      strokeA: 40 * a
    })

    ;(g.drawingContext as CanvasRenderingContext2D).globalAlpha = 0.82 * a
    let ry = top + padY
    rows.forEach((row, i) => {
      let rx = cx - rowWidths[i] / 2
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

  private drawOverlay(g: P5.Graphics, w: number, h: number): void {
    const a = this.overlay.t
    if (a <= 0.004) return
    const titleCol = this.overlay.kind === 'over' ? RED : UI.accent

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
    g.scale(0.96 + 0.04 * a)
    g.translate(0, (1 - a) * 8)

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

  private drawBanner(g: P5.Graphics, w: number, h: number): void {
    const a = smooth(this.banner.appear)
    if (a <= 0.004 || !this.banner.text) return
    const accent = UI.accent
    const text = this.banner.text.toUpperCase()

    g.textSize(20)
    setTracking(g, 2)
    const tw = g.textWidth(text)
    const bw = tw + 52
    const bh = 48

    g.push()
    g.translate(w / 2, h * 0.34)
    g.scale(0.9 + 0.1 * a)

    g.noStroke()
    g.fill(0, 0, 0, 0.72 * 255 * a)
    g.rect(-bw / 2, -bh / 2, bw, bh, 10)
    g.noFill()
    g.stroke(accent[0], accent[1], accent[2], 255 * a)
    g.strokeWeight(2)
    g.rect(-bw / 2, -bh / 2, bw, bh, 10)

    const dc = g.drawingContext as CanvasRenderingContext2D
    g.noStroke()
    g.fill(accent[0], accent[1], accent[2], 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(20)
    setTracking(g, 2)
    dc.shadowColor = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${0.5 * a})`
    dc.shadowBlur = 20
    g.text(text, -1, 0)
    g.pop()
  }
}
