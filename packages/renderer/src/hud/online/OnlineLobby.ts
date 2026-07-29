import type { OnlineClient } from '../../app/online'
import { buildOnlineLobbyView, type OnlineLobbyView } from './model'

export interface OnlineLobbyHandlers {
  /** Leave online flow and return to the canvas menu. */
  onExit: () => void
}

/**
 * Keyboard-accessible DOM overlay for Online Versus auth + private lobby.
 * No `prompt()`, no credential persistence — fields live only in the DOM.
 */
export class OnlineLobby {
  private readonly root: HTMLElement
  private readonly client: OnlineClient
  private readonly handlers: OnlineLobbyHandlers
  private unsubscribe?: () => void
  private view: OnlineLobbyView
  private busy = false
  private styleEl?: HTMLStyleElement
  private open = false
  /** Optional: sketch sets this when the online match scene is active. */
  private matchSceneActive = false

  constructor(client: OnlineClient, parent: HTMLElement, handlers: OnlineLobbyHandlers) {
    this.client = client
    this.handlers = handlers
    this.view = buildOnlineLobbyView(client.getState())
    this.ensureStyles()
    this.root = document.createElement('div')
    this.root.className = 'online-lobby'
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-label', 'Online Versus lobby')
    this.root.hidden = true
    parent.appendChild(this.root)
    this.root.addEventListener('click', this.onClick)
    this.root.addEventListener('submit', this.onSubmit)
    this.unsubscribe = client.subscribe((state) => {
      this.view = buildOnlineLobbyView(state, { matchSceneActive: this.matchSceneActive })
      this.render()
    })
    this.render()
  }

  public get isOpen(): boolean {
    return this.open
  }

  public show(): void {
    this.open = true
    this.root.hidden = false
    this.render()
    queueMicrotask(() => this.focusFirst())
  }

  public hide(): void {
    this.open = false
    this.root.hidden = true
  }

  /** Called by the sketch when entering / leaving the online play scene. */
  public setMatchSceneActive(active: boolean): void {
    this.matchSceneActive = active
    this.view = buildOnlineLobbyView(this.client.getState(), { matchSceneActive: active })
    this.render()
  }

  public dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.root.removeEventListener('click', this.onClick)
    this.root.removeEventListener('submit', this.onSubmit)
    this.root.remove()
    this.styleEl?.remove()
    this.styleEl = undefined
    this.open = false
  }

  private focusFirst(): void {
    const el = this.root.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')
    el?.focus()
  }

  private readonly onClick = (e: MouseEvent): void => {
    const t = e.target
    if (!(t instanceof Element)) return
    // Submit controls must not hit runAction early — that re-renders and
    // detaches the form before the submit handler can read FormData.
    const control = t.closest('button, input')
    if (control instanceof HTMLButtonElement && control.type === 'submit') return
    if (control instanceof HTMLInputElement && control.type === 'submit') return

    const actionEl = t.closest<HTMLElement>('[data-action]')
    const action = actionEl?.dataset.action
    if (!action || actionEl instanceof HTMLFormElement) return
    void this.runAction(action)
  }

  private readonly onSubmit = (e: Event): void => {
    e.preventDefault()
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    const action = form.dataset.action
    if (action) void this.runAction(action, new FormData(form))
  }

  private async runAction(action: string, form?: FormData): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.render()
    try {
      switch (action) {
        case 'exit':
          this.handlers.onExit()
          break
        case 'login':
          await this.doLogin(form)
          break
        case 'register':
          await this.doRegister(form)
          break
        case 'connect':
          await this.client.connect()
          break
        case 'create-room': {
          const name = String(form?.get('roomName') ?? 'Private room').trim() || 'Private room'
          this.client.createRoom({ name, maxPlayers: 2, isPrivate: true })
          break
        }
        case 'join-room': {
          const roomId = String(form?.get('roomId') ?? '').trim()
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
        default:
          break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.view = {
        ...this.view,
        errorText: message,
        statusText: 'Something went wrong'
      }
      this.render()
    } finally {
      this.busy = false
      this.render()
    }
  }

  private async doLogin(form?: FormData): Promise<void> {
    const email = String(form?.get('email') ?? '').trim()
    const password = String(form?.get('password') ?? '')
    if (!email || !password) throw new Error('Email and password are required')
    await this.client.login({ email, password })
    await this.client.connect()
  }

  private async doRegister(form?: FormData): Promise<void> {
    const email = String(form?.get('email') ?? '').trim()
    const displayName = String(form?.get('displayName') ?? '').trim()
    const password = String(form?.get('password') ?? '')
    if (!email || !displayName || !password) {
      throw new Error('Email, display name, and password are required')
    }
    await this.client.register({ email, displayName, password })
    await this.client.connect()
  }

  private render(): void {
    const v = this.view
    if (v.panel === 'match-hidden') {
      this.root.hidden = true
      this.root.innerHTML = ''
      return
    }
    // Skip DOM rebuilds while the overlay is closed — avoid wiping typed fields
    // when client notifies fire in the background.
    if (!this.open) return

    this.root.hidden = false
    const preserved = captureFieldState(this.root)

    const error = v.errorText
      ? `<p class="online-lobby__error" role="alert">${escapeHtml(v.errorText)}</p>`
      : ''
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
      return
    }

    if (v.panel === 'terminal') {
      this.root.innerHTML = `
        <div class="online-lobby__card" ${busyAttr}>
          <header class="online-lobby__header">
            <h1>${escapeHtml(v.terminalTitle ?? 'Match over')}</h1>
            <p>${escapeHtml(v.terminalSub ?? v.statusText)}</p>
          </header>
          ${error}
          <div class="online-lobby__actions">
            <button type="button" data-action="exit">Back to menu</button>
          </div>
        </div>`
      restoreFieldState(this.root, preserved)
      return
    }

    // Lobby panel
    const roomBlock = v.roomId
      ? `
        <section class="online-lobby__room" aria-label="Room">
          <p class="online-lobby__room-id">
            Room <code>${escapeHtml(v.roomId)}</code>
            <button type="button" data-action="copy-room" title="Copy room ID">Copy</button>
          </p>
          <ul class="online-lobby__players">
            ${v.players
              .map(
                (p) => `<li>
                  <span>${escapeHtml(p.displayName)}${p.isHost ? ' · host' : ''}${p.isSelf ? ' · you' : ''}</span>
                  <span>${p.ready ? 'Ready' : 'Not ready'}</span>
                </li>`
              )
              .join('')}
          </ul>
          <div class="online-lobby__actions">
            <button type="button" data-action="toggle-ready" ${this.busy ? 'disabled' : ''}>
              ${v.selfReady ? 'Unready' : 'Ready'}
            </button>
            ${
              v.isHost
                ? `<button type="button" data-action="start" ${!v.canStart || this.busy ? 'disabled' : ''}>Start</button>`
                : ''
            }
            <button type="button" data-action="leave-room" ${this.busy ? 'disabled' : ''}>Leave room</button>
          </div>
        </section>`
      : `
        <form class="online-lobby__form" data-action="create-room">
          <label>Room name <input name="roomName" type="text" maxlength="48" value="Private room" /></label>
          <button type="submit" ${this.busy || v.connection !== 'ready' ? 'disabled' : ''}>Create private room</button>
        </form>
        <form class="online-lobby__form" data-action="join-room">
          <label>Room ID <input name="roomId" type="text" required autocomplete="off" spellcheck="false" /></label>
          <button type="submit" ${this.busy || v.connection !== 'ready' ? 'disabled' : ''}>Join by ID</button>
        </form>
        ${
          v.connection !== 'ready'
            ? `<button type="button" data-action="connect" ${this.busy ? 'disabled' : ''}>Reconnect</button>`
            : ''
        }`

    const who = this.client.user
    this.root.innerHTML = `
      <div class="online-lobby__card" ${busyAttr}>
        <header class="online-lobby__header">
          <h1>Online Versus</h1>
          <p>Signed in as <strong>${escapeHtml(who?.displayName ?? '')}</strong></p>
        </header>
        ${error}
        ${roomBlock}
        <p class="online-lobby__status">${escapeHtml(v.statusText)}</p>
        <button type="button" class="online-lobby__link" data-action="exit">Back to menu</button>
      </div>`
    restoreFieldState(this.root, preserved)
  }

  private ensureStyles(): void {
    if (document.getElementById('online-lobby-styles')) return
    this.styleEl = document.createElement('style')
    this.styleEl.id = 'online-lobby-styles'
    this.styleEl.textContent = ONLINE_LOBBY_CSS
    document.head.appendChild(this.styleEl)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface FieldSnapshot {
  values: Map<string, string>
  focusKey: string | null
  selectionStart: number | null
  selectionEnd: number | null
}

function fieldKey(input: HTMLInputElement): string {
  const form = input.closest('form')
  const formAction = form?.dataset.action ?? form?.id ?? ''
  return `${formAction}::${input.name}`
}

function captureFieldState(root: HTMLElement): FieldSnapshot {
  const values = new Map<string, string>()
  for (const input of root.querySelectorAll('input')) {
    if (!(input instanceof HTMLInputElement) || !input.name) continue
    values.set(fieldKey(input), input.value)
  }

  let focusKey: string | null = null
  let selectionStart: number | null = null
  let selectionEnd: number | null = null
  const active = document.activeElement
  if (active instanceof HTMLInputElement && root.contains(active) && active.name) {
    focusKey = fieldKey(active)
    selectionStart = active.selectionStart
    selectionEnd = active.selectionEnd
  } else if (active instanceof HTMLElement && root.contains(active)) {
    const action = active.dataset.action
    if (action) focusKey = `action::${action}`
  }

  return { values, focusKey, selectionStart, selectionEnd }
}

function restoreFieldState(root: HTMLElement, snapshot: FieldSnapshot): void {
  for (const input of root.querySelectorAll('input')) {
    if (!(input instanceof HTMLInputElement) || !input.name) continue
    const key = fieldKey(input)
    if (!snapshot.values.has(key)) continue
    input.value = snapshot.values.get(key)!
  }

  if (!snapshot.focusKey) return
  if (snapshot.focusKey.startsWith('action::')) {
    const action = snapshot.focusKey.slice('action::'.length)
    root.querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`)?.focus()
    return
  }

  for (const input of root.querySelectorAll('input')) {
    if (!(input instanceof HTMLInputElement) || !input.name) continue
    if (fieldKey(input) !== snapshot.focusKey) continue
    input.focus()
    if (snapshot.selectionStart != null && snapshot.selectionEnd != null) {
      try {
        input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
      } catch {
        // Some input types (e.g. email in older engines) reject selection ranges.
      }
    }
    return
  }
}

const ONLINE_LOBBY_CSS = `
.online-lobby {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  background: rgba(4, 6, 12, 0.72);
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
  color: #eef2ff;
  pointer-events: auto;
}
.online-lobby[hidden] { display: none !important; }
.online-lobby__card {
  width: min(420px, 100%);
  max-height: min(90vh, 720px);
  overflow: auto;
  padding: 28px 24px 20px;
  border-radius: 16px;
  background: rgba(12, 15, 26, 0.94);
  border: 1px solid rgba(238, 242, 255, 0.12);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}
.online-lobby__header h1 {
  margin: 0 0 6px;
  font-size: 22px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
}
.online-lobby__header p {
  margin: 0 0 16px;
  font-size: 12px;
  opacity: 0.7;
  line-height: 1.45;
}
.online-lobby__form {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}
.online-lobby__form--register {
  padding-top: 8px;
  border-top: 1px solid rgba(238, 242, 255, 0.08);
}
.online-lobby__form label {
  display: grid;
  gap: 4px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.85;
}
.online-lobby__form input {
  font: inherit;
  font-size: 14px;
  letter-spacing: 0;
  text-transform: none;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(238, 242, 255, 0.18);
  background: rgba(0, 0, 0, 0.35);
  color: #eef2ff;
}
.online-lobby__form input:focus {
  outline: 2px solid #6ea8ff;
  outline-offset: 1px;
}
.online-lobby__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.online-lobby button {
  font: inherit;
  font-size: 13px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(110, 168, 255, 0.45);
  background: rgba(110, 168, 255, 0.16);
  color: #eef2ff;
  cursor: pointer;
}
.online-lobby button:hover:not(:disabled) {
  background: rgba(110, 168, 255, 0.28);
}
.online-lobby button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.online-lobby button:focus-visible {
  outline: 2px solid #6ea8ff;
  outline-offset: 2px;
}
.online-lobby__link {
  display: block;
  width: 100%;
  margin-top: 12px;
  background: transparent !important;
  border-color: transparent !important;
  opacity: 0.75;
  text-align: center;
}
.online-lobby__status {
  margin: 12px 0 0;
  font-size: 12px;
  opacity: 0.65;
  line-height: 1.4;
}
.online-lobby__error {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(220, 70, 70, 0.18);
  border: 1px solid rgba(220, 70, 70, 0.4);
  color: #ffc9c9;
  font-size: 12px;
  line-height: 1.4;
}
.online-lobby__room-id {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  margin: 0 0 12px;
}
.online-lobby__room-id code {
  font: inherit;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  letter-spacing: 0.04em;
}
.online-lobby__players {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: grid;
  gap: 6px;
}
.online-lobby__players li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(238, 242, 255, 0.05);
  font-size: 13px;
}
`
