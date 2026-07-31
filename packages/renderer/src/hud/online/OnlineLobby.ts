import type P5 from 'p5'
import type { OnlineClient } from '../../app/online'
import { settings } from '../../config/settings'
import { UI } from '../../config/themes'
import { smooth } from '../../core/ease'
import {
  actionRowBackground,
  clipRect,
  composite,
  createScrollState,
  DISABLED_DIM,
  drawScrollIndicator,
  ensureBuffer,
  FG,
  focusRing,
  MONO,
  panel,
  RED,
  scrollBy,
  scrollIntoView,
  sectionLabel,
  setTracking,
  titlebarClearance,
  truncate,
  unclip,
  updateScroll,
  type ScrollState
} from '../widgets'
import {
  CARD_MARGIN_X,
  CARD_MARGIN_Y,
  CARD_W,
  DIM,
  FOOTER_H,
  HEADING_H,
  inside,
  MIN_VIEWPORT_H,
  PAD_X,
  PRIMARY_IDLE_STROKE_A,
  PRIMARY_IDLE_WASH_A,
  PRIMARY_TEXT_SIZE,
  ROW_GAP,
  ROW_H,
  SCROLL_INDICATOR_X,
  TITLE_H,
  WHEEL_STEP
} from '../menu/model'
import type { Rect } from '../menu/types'
import {
  buildLobbyEntries,
  buildOnlineLobbyView,
  type LobbyActionId,
  type LobbyEntry,
  type LobbyFieldId,
  type OnlineLobbyView
} from './model'

export interface OnlineLobbyHandlers {
  /** Leave online flow and return to the canvas menu. */
  onExit: () => void
}

const FIELD_W = 250
const FIELD_H = ROW_H - 14
const NOTE_H = 34

/** Field values live only in memory for the session — nothing is persisted. */
type FieldValues = Record<LobbyFieldId, string>

const emptyFields = (): FieldValues => ({
  email: '',
  password: '',
  regName: '',
  regEmail: '',
  regPassword: '',
  roomName: 'Private room',
  roomId: ''
})

/**
 * Online Versus auth + private-lobby card, drawn with p5 into the same
 * off-screen 2D buffer as {@link Menu} and the in-game HUD rather than as a DOM
 * overlay — same card, rows and focus ring as the rest of the chrome.
 *
 * Text fields are canvas-drawn: keystrokes come from a window `keydown`
 * listener and paste from the window `paste` event. That means no browser
 * autofill / password manager, which is the trade for keeping the whole UI in
 * one surface; credentials still never leave this object.
 */
export class OnlineLobby {
  private g?: P5.Graphics
  private readonly client: OnlineClient
  private readonly handlers: OnlineLobbyHandlers
  private unsubscribe?: () => void
  private view: OnlineLobbyView
  private values: FieldValues = emptyFields()
  private focusId: LobbyFieldId | LobbyActionId | null = null
  private busy = false
  private open = false
  private clock = 0
  private t = 0
  private lastDt = 0
  private matchSceneActive = false
  private readonly scroll: ScrollState = createScrollState()
  private hits: { id: LobbyFieldId | LobbyActionId; kind: 'field' | 'action'; rect: Rect }[] = []

  constructor(client: OnlineClient, handlers: OnlineLobbyHandlers) {
    this.client = client
    this.handlers = handlers
    this.view = buildOnlineLobbyView(client.getState())
    this.unsubscribe = client.subscribe((state) => {
      this.view = buildOnlineLobbyView(state, { matchSceneActive: this.matchSceneActive })
      this.ensureFocus()
    })
  }

  public get isOpen(): boolean {
    return this.open && this.view.panel !== 'match-hidden'
  }

  public show(): void {
    if (this.open) return
    this.open = true
    this.scroll.offset = 0
    this.scroll.target = 0
    this.ensureFocus(true)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('paste', this.onPaste)
  }

  public hide(): void {
    this.open = false
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('paste', this.onPaste)
  }

  /** Called by the sketch when entering / leaving the online play scene. */
  public setMatchSceneActive(active: boolean): void {
    this.matchSceneActive = active
    this.view = buildOnlineLobbyView(this.client.getState(), { matchSceneActive: active })
  }

  public dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.hide()
    this.values = emptyFields()
  }

  // --- model -----------------------------------------------------------------
  private entries(): LobbyEntry[] {
    return buildLobbyEntries(this.view, { busy: this.busy })
  }

  private focusables(): Extract<LobbyEntry, { kind: 'field' | 'action' }>[] {
    return this.entries().flatMap((e) => (e.kind === 'field' || (e.kind === 'action' && !e.disabled) ? [e] : []))
  }

  /** Keep focus on something that still exists after a state-driven rebuild. */
  private ensureFocus(reset = false): void {
    const list = this.focusables()
    if (reset || !list.some((e) => e.id === this.focusId)) {
      this.focusId = list[0]?.id ?? null
    }
  }

  private move(step: number): void {
    const list = this.focusables()
    if (list.length === 0) return
    const at = list.findIndex((e) => e.id === this.focusId)
    const next = (((at < 0 ? 0 : at + step) % list.length) + list.length) % list.length
    this.focusId = list[next].id
    this.scrollToFocused()
  }

  private scrollToFocused(): void {
    let y = 0
    for (const e of this.entries()) {
      if ((e.kind === 'field' || e.kind === 'action') && e.id === this.focusId) {
        scrollIntoView(this.scroll, y, ROW_H)
        return
      }
      y += entryHeight(e) + ROW_GAP
    }
  }

  /** Enter inside a field runs the action that follows it — the form's submit. */
  private submitFrom(fieldId: LobbyFieldId): void {
    const entries = this.entries()
    const at = entries.findIndex((e) => e.kind === 'field' && e.id === fieldId)
    for (const e of entries.slice(at + 1)) {
      if (e.kind === 'action') {
        if (!e.disabled) void this.runAction(e.id)
        return
      }
    }
  }

  // --- keyboard --------------------------------------------------------------
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return

    const field = this.entries().find((x) => x.kind === 'field' && x.id === this.focusId)
    const fieldId = field?.kind === 'field' ? field.id : null

    switch (e.key) {
      case 'Escape':
        this.handlers.onExit()
        break
      case 'Tab':
        this.move(e.shiftKey ? -1 : 1)
        break
      case 'ArrowUp':
        this.move(-1)
        break
      case 'ArrowDown':
        this.move(1)
        break
      case 'Enter':
        if (fieldId) this.submitFrom(fieldId)
        else if (this.focusId) void this.runAction(this.focusId as LobbyActionId)
        break
      case 'Backspace':
        if (!fieldId) return
        this.values[fieldId] = this.values[fieldId].slice(0, -1)
        break
      default:
        // Printable characters only; modifiers (Ctrl+V, shortcuts) pass through
        // so the browser still fires `paste`.
        if (!fieldId || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
        this.values[fieldId] += e.key
        break
    }
    e.preventDefault()
  }

  private readonly onPaste = (e: ClipboardEvent): void => {
    if (!this.isOpen) return
    const field = this.entries().find((x) => x.kind === 'field' && x.id === this.focusId)
    if (field?.kind !== 'field') return
    const text = e.clipboardData?.getData('text') ?? ''
    if (!text) return
    this.values[field.id] += text.replace(/[\r\n\t]/g, '').trim()
    e.preventDefault()
  }

  // --- mouse -----------------------------------------------------------------
  public pointer(x: number, y: number): void {
    if (!this.isOpen) return
    const hit = this.hits.find((h) => inside(h.rect, x, y))
    if (hit) this.focusId = hit.id
  }

  public click(x: number, y: number): void {
    if (!this.isOpen) return
    const hit = this.hits.find((h) => inside(h.rect, x, y))
    if (!hit) return
    this.focusId = hit.id
    if (hit.kind === 'action') void this.runAction(hit.id as LobbyActionId)
  }

  public wheel(delta: number): void {
    if (!this.isOpen) return
    scrollBy(this.scroll, delta * WHEEL_STEP)
  }

  public cursorStyle(x: number, y: number): 'pointer' | 'default' {
    if (!this.isOpen) return 'default'
    return this.hits.some((h) => inside(h.rect, x, y)) ? 'pointer' : 'default'
  }

  // --- actions ---------------------------------------------------------------
  private async runAction(action: LobbyActionId): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      switch (action) {
        case 'exit':
          this.handlers.onExit()
          break
        case 'login': {
          const email = this.values.email.trim()
          const password = this.values.password
          if (!email || !password) throw new Error('Email and password are required')
          await this.client.login({ email, password })
          await this.client.connect()
          break
        }
        case 'register': {
          const email = this.values.regEmail.trim()
          const displayName = this.values.regName.trim()
          const password = this.values.regPassword
          if (!email || !displayName || !password) {
            throw new Error('Email, display name, and password are required')
          }
          await this.client.register({ email, displayName, password })
          await this.client.connect()
          break
        }
        case 'connect':
          await this.client.connect()
          break
        case 'create-room': {
          const name = this.values.roomName.trim() || 'Private room'
          this.client.createRoom({ name, maxPlayers: 2, isPrivate: true })
          break
        }
        case 'join-room': {
          const roomId = this.values.roomId.trim()
          if (!roomId) throw new Error('Enter a room ID')
          this.client.joinRoom(roomId)
          break
        }
        case 'toggle-ready':
          this.client.setReady(!this.view.selfReady)
          break
        case 'start':
          if (this.view.canStart) this.client.startGame()
          break
        case 'leave-room':
          this.client.leaveRoom()
          break
        case 'copy-room':
          if (this.view.roomId && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(this.view.roomId)
          }
          break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.view = { ...this.view, errorText: message, statusText: 'Something went wrong' }
    } finally {
      this.busy = false
      this.ensureFocus()
    }
  }

  // --- painting --------------------------------------------------------------
  public update(dt: number): void {
    this.lastDt = dt
    this.clock += dt
    const target = this.isOpen ? 1 : 0
    this.t += (target - this.t) * (1 - Math.exp(-dt * 12))
    if (!this.isOpen && this.t < 0.004) this.t = 0
  }

  public paint(p: P5): void {
    if (this.t <= 0.004) return
    const w = p.width
    const h = p.height
    const g = (this.g = ensureBuffer(p, this.g, w, h))
    const a = smooth(this.t)
    const rm = settings.reducedMotionActive

    g.clear(0, 0, 0, 0)
    g.textFont(MONO)

    g.push()
    g.noStroke()
    g.fill(DIM[0], DIM[1], DIM[2], 0.72 * 255 * a)
    g.rect(0, 0, w, h)
    g.pop()

    const entries = this.entries()
    const bodyH = entries.reduce((acc, e) => acc + entryHeight(e) + ROW_GAP, 0) - ROW_GAP

    const s = Math.min(1, (w - 2 * CARD_MARGIN_X) / CARD_W)
    const marginTop = titlebarClearance() + CARD_MARGIN_Y
    const bandH = h - marginTop - CARD_MARGIN_Y
    const viewportH = Math.max(MIN_VIEWPORT_H, Math.min(bandH / s - TITLE_H - FOOTER_H, bodyH))
    const cardH = TITLE_H + viewportH + FOOTER_H
    const originX = w / 2 - (CARD_W * s) / 2
    const originY = marginTop + (bandH - cardH * s) / 2 + (rm ? 0 : (1 - a) * 10)

    this.scroll.viewport = viewportH
    this.scroll.content = bodyH
    updateScroll(this.scroll, this.lastDt)

    this.hits = []

    g.push()
    g.translate(originX, originY)
    g.scale(s)

    panel(g, 0, 0, CARD_W, cardH, { r: 18, fill: [12, 15, 26], fillA: 0.9 * 255 * a, strokeA: 60 * a })
    this.drawTitle(g, a)

    const place = { originX, originY: originY + (TITLE_H - this.scroll.offset) * s, s }
    clipRect(g, 0, TITLE_H, CARD_W, viewportH)
    g.translate(0, TITLE_H - this.scroll.offset)

    let y = 0
    for (const entry of entries) {
      const visible = y + entryHeight(entry) >= this.scroll.offset && y <= this.scroll.offset + viewportH
      if (visible) this.drawEntry(g, entry, y, a)
      if (visible && (entry.kind === 'field' || entry.kind === 'action')) {
        this.hits.push({
          id: entry.id,
          kind: entry.kind,
          rect: { x: place.originX + PAD_X * s, y: place.originY + y * s, w: (CARD_W - PAD_X * 2) * s, h: ROW_H * s }
        })
      }
      y += entryHeight(entry) + ROW_GAP
    }
    unclip(g)

    drawScrollIndicator(g, SCROLL_INDICATOR_X, TITLE_H, viewportH, this.scroll, UI.accent, a)
    this.drawFooter(g, cardH, a)
    g.pop()

    setTracking(g, 0)
    composite(p, g)
  }

  private drawTitle(g: P5.Graphics, a: number): void {
    const accent = UI.accent
    const dc = g.drawingContext as CanvasRenderingContext2D
    const title = this.view.panel === 'terminal' ? (this.view.terminalTitle ?? 'MATCH OVER') : 'ONLINE VERSUS'
    const won = title === 'YOU WIN'
    const color = this.view.panel === 'terminal' && !won ? RED : accent

    g.push()
    g.noStroke()
    g.fill(color[0], color[1], color[2], 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(26)
    setTracking(g, 5)
    dc.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.45 * a})`
    dc.shadowBlur = 22
    g.text(title, CARD_W / 2 - 3, 46)
    g.pop()

    const sub = this.view.userName ? `${this.view.statusText}  ·  ${this.view.userName}` : this.view.statusText
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 0.5 * 255 * a)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(11)
    setTracking(g, 1.4)
    g.text(truncate(g, sub, CARD_W - PAD_X * 2), CARD_W / 2 - 0.7, 74)
    g.pop()
  }

  private drawEntry(g: P5.Graphics, e: LobbyEntry, y: number, a: number): void {
    if (e.kind === 'heading') {
      sectionLabel(g, e.label, PAD_X, y + HEADING_H / 2, CARD_W - PAD_X, a)
      return
    }
    // Skip DOM rebuilds while the overlay is closed — avoid wiping typed fields
    // when client notifies fire in the background.
    if (!this.open) return

    this.root.hidden = false
    const preserved = captureFieldState(this.root)

    const error = v.errorText ? `<p class="online-lobby__error" role="alert">${escapeHtml(v.errorText)}</p>` : ''
    const busyAttr = this.busy ? 'aria-busy="true"' : ''

    if (v.panel === 'auth' || !this.client.user) {
      this.root.innerHTML = `
        <div class="online-lobby__card" ${busyAttr}>
          <header class="online-lobby__header">
            <h1>Online Versus</h1>
            <p>Sign in or register — credentials stay in this session only.</p>
          </header>
          ${error}
          <form class="online-lobby__form" data-action="login">
            <label>Email <input name="email" type="email" autocomplete="username" required /></label>
            <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
            <div class="online-lobby__actions">
              <button type="submit" ${this.busy ? 'disabled' : ''}>Sign in</button>
            </div>
          </form>
          <form id="online-register" class="online-lobby__form online-lobby__form--register" data-action="register">
            <label>Display name <input name="displayName" type="text" autocomplete="nickname" required maxlength="32" /></label>
            <label>Email <input name="email" type="email" autocomplete="username" required /></label>
            <label>Password <input name="password" type="password" autocomplete="new-password" required minlength="8" /></label>
            <div class="online-lobby__actions">
              <button type="submit" ${this.busy ? 'disabled' : ''}>Register</button>
            </div>
          </form>
          <p class="online-lobby__status">${escapeHtml(v.statusText)}</p>
          <button type="button" class="online-lobby__link" data-action="exit">Back to menu</button>
        </div>`
    restoreFieldState(this.root, preserved)
    if (e.kind === 'gap') return
    if (e.kind === 'note') {
      this.drawNote(g, e.label, e.tone, y, a)
      return
    }
    if (e.kind === 'stat') {
      this.drawStat(g, e.label, e.value, y, a)
      return
    }
    if (e.kind === 'field') this.drawField(g, e, y, a)
    else this.drawAction(g, e, y, a)
  }

  private drawNote(g: P5.Graphics, label: string, tone: 'error' | 'dim', y: number, a: number): void {
    const x = PAD_X
    const w = CARD_W - PAD_X * 2
    const color = tone === 'error' ? RED : FG
    g.push()
    g.noStroke()
    g.fill(color[0], color[1], color[2], (tone === 'error' ? 28 : 14) * a)
    g.rect(x, y, w, NOTE_H, 8)
    g.fill(color[0], color[1], color[2], (tone === 'error' ? 230 : 170) * a)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(11)
    setTracking(g, 0.4)
    g.text(truncate(g, label, w - 28), x + 14, y + NOTE_H / 2)
    g.pop()
  }

  private drawStat(g: P5.Graphics, label: string, value: string, y: number, a: number): void {
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 185 * a)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(13)
    setTracking(g, 0.4)
    g.text(truncate(g, label, CARD_W - PAD_X * 2 - 140), PAD_X + 16, y + ROW_H / 2)
    g.fill(UI.accent[0], UI.accent[1], UI.accent[2], 235 * a)
    g.textAlign(g.RIGHT, g.CENTER)
    setTracking(g, 0.2)
    g.text(value, CARD_W - PAD_X - 16, y + ROW_H / 2)
    g.pop()
  }

  private drawField(g: P5.Graphics, e: Extract<LobbyEntry, { kind: 'field' }>, y: number, a: number): void {
    const x = PAD_X
    const w = CARD_W - PAD_X * 2
    const focused = this.focusId === e.id
    const accent = UI.accent

    if (focused) {
      actionRowBackground(g, x, y, w, ROW_H, {
        color: accent,
        washAlpha: 18 * a,
        strokeAlpha: 40 * a,
        notchAlpha: 255 * a
      })
      focusRing(g, x, y, w, ROW_H, { color: accent, alpha: a })
    }

    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 235 * a)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(13)
    setTracking(g, 0.4)
    g.text(e.label, x + 16, y + ROW_H / 2)
    g.pop()

    const bx = x + w - 16 - FIELD_W
    const by = y + (ROW_H - FIELD_H) / 2
    panel(g, bx, by, FIELD_W, FIELD_H, {
      r: 8,
      fill: [0, 0, 0],
      fillA: 110 * a,
      strokeA: (focused ? 110 : 45) * a
    })

    const raw = this.values[e.id]
    const shown = e.secret ? '•'.repeat(raw.length) : raw
    const innerW = FIELD_W - 20
    g.push()
    g.noStroke()
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(12)
    setTracking(g, 0.2)
    const text = shown ? fitTail(g, shown, innerW) : (e.placeholder ?? '')
    g.fill(FG[0], FG[1], FG[2], (shown ? 235 : 85) * a)
    g.text(text, bx + 10, by + FIELD_H / 2)
    if (focused) {
      const blink = Math.sin(this.clock * 6) > -0.2
      if (blink) {
        const caretX = bx + 10 + Math.min(innerW, g.textWidth(text || ''))
        g.stroke(accent[0], accent[1], accent[2], 220 * a)
        g.strokeWeight(1.5)
        g.line(caretX + 2, by + 5, caretX + 2, by + FIELD_H - 5)
      }
    }
    g.pop()
  }

  private drawAction(g: P5.Graphics, e: Extract<LobbyEntry, { kind: 'action' }>, y: number, a: number): void {
    const x = PAD_X
    const w = CARD_W - PAD_X * 2
    const accent = UI.accent
    const focused = this.focusId === e.id && !e.disabled
    const dim = e.disabled ? DISABLED_DIM : 1

    if (e.primary && !focused && !e.disabled) {
      actionRowBackground(g, x, y, w, ROW_H, {
        color: accent,
        washAlpha: PRIMARY_IDLE_WASH_A * a,
        strokeAlpha: PRIMARY_IDLE_STROKE_A * a
      })
    }
    if (focused) {
      const glow = 0.5 + 0.5 * Math.sin(this.clock * 3)
      actionRowBackground(g, x, y, w, ROW_H, {
        color: accent,
        washAlpha: (20 + glow * 10 + (e.primary ? 12 : 0)) * a,
        strokeAlpha: 50 * a,
        notchAlpha: 255 * a
      })
      focusRing(g, x, y, w, ROW_H, { color: accent, alpha: a })
    }

    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 235 * a * dim)
    g.textAlign(g.LEFT, g.CENTER)
    g.textSize(e.primary ? PRIMARY_TEXT_SIZE : 15)
    setTracking(g, 1.2)
    g.text(e.label, x + 16, y + ROW_H / 2)
    g.pop()
  }

  private drawFooter(g: P5.Graphics, cardH: number, a: number): void {
    const hint = this.busy ? 'Working…' : '↑↓ Navigate   ·   Type to edit   ·   Enter Confirm   ·   Esc Menu'
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

function entryHeight(e: LobbyEntry): number {
  if (e.kind === 'heading') return HEADING_H
  if (e.kind === 'gap') return e.h
  if (e.kind === 'note') return NOTE_H
  return ROW_H
}

/** Keep the *end* of a typed value visible, dropping characters off the front. */
function fitTail(g: P5.Graphics, text: string, maxWidth: number): string {
  let out = text
  while (out.length > 1 && g.textWidth(out) > maxWidth) out = out.slice(1)
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
