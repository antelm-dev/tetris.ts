import { BINDS, normalizeKey, type Bind } from '../config/keymap'
import { settings } from '../config/settings'
import type { Game, Action } from '../engine'
import { ARR, DAS, SOFT_DROP, resolveHorizontal, tickRepeat } from './timing'

/** Game action each binding dispatches. */
const ACTIONS: Record<Bind, Action> = {
  left: 'left',
  right: 'right',
  softDrop: 'down',
  hardDrop: 'push',
  rotateRight: 'rotate-right',
  rotateLeft: 'rotate-left',
  hold: 'hold',
  pause: 'pause'
}

/** Bindings that fire once per press; the rest auto-repeat while held. */
const TAPS: ReadonlySet<Bind> = new Set<Bind>(['hardDrop', 'rotateRight', 'rotateLeft', 'hold', 'pause'])

/**
 * Frame-rate-independent input with real DAS/ARR timing. Taps are dispatched on
 * keydown; horizontal movement and soft-drop auto-repeat on independent
 * millisecond clocks advanced by the render loop via {@link update}, so holding
 * soft-drop never cancels a held horizontal shift.
 *
 * The key → action map is rebuilt from {@link settings} whenever the user
 * rebinds a key, so a change in the settings screen takes effect immediately.
 */
export class Input {
  private readonly down = new Set<Bind>()
  private map = new Map<string, Bind>()
  private hTimer = 0
  private hRepeating = false
  private hLast: 'left' | 'right' | undefined
  private vTimer = 0
  private readonly unsubscribe: () => void

  constructor(private readonly game: Game) {
    this.rebuild()
    this.unsubscribe = settings.subscribe(() => this.rebuild())
  }

  private rebuild(): void {
    this.map = new Map()
    for (const bind of BINDS) {
      for (const key of settings.keysFor(bind)) this.map.set(key, bind)
    }
    // A key may have just been unbound while held — drop any stale held state.
    this.down.clear()
    this.hRepeating = false
    this.hLast = undefined
  }

  public attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  public detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.onBlur()
  }

  /** Release every listener and the settings subscription. */
  public dispose(): void {
    this.detach()
    this.unsubscribe()
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const bind = this.map.get(normalizeKey(e.key))
    if (!bind) return
    e.preventDefault()
    if (this.down.has(bind)) return // ignore OS key-repeat
    this.down.add(bind)

    if (TAPS.has(bind)) {
      if (!e.repeat) this.game.action(ACTIONS[bind])
      return
    }

    if (bind === 'left' || bind === 'right') {
      this.hLast = bind
      this.hTimer = 0
      this.hRepeating = false
      this.game.action(ACTIONS[bind]) // immediate first step
    }
    if (bind === 'softDrop') {
      this.vTimer = 0
      this.game.action(ACTIONS[bind])
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const bind = this.map.get(normalizeKey(e.key))
    if (!bind) return
    this.down.delete(bind)
    this.hLast = this.currentHorizontal
    if (!this.hLast) this.hRepeating = false
  }

  private readonly onBlur = (): void => {
    this.down.clear()
    this.hRepeating = false
    this.hLast = undefined
  }

  /** Whichever horizontal direction is currently held (most recent wins ties). */
  private get currentHorizontal(): 'left' | 'right' | undefined {
    return resolveHorizontal(this.down.has('left'), this.down.has('right'), this.hLast)
  }

  /** Advance auto-repeat by `dt` seconds. Call once per rendered frame. */
  public update(dt: number): void {
    const ms = dt * 1000

    const dir = this.currentHorizontal
    if (dir) {
      const stepped = tickRepeat({ timer: this.hTimer, repeating: this.hRepeating }, ms, true, DAS, ARR)
      this.hTimer = stepped.state.timer
      this.hRepeating = stepped.state.repeating
      for (let i = 0; i < stepped.fires; i++) this.game.action(ACTIONS[dir])
    }

    if (this.down.has('softDrop')) {
      const stepped = tickRepeat({ timer: this.vTimer, repeating: true }, ms, true, SOFT_DROP, SOFT_DROP)
      this.vTimer = stepped.state.timer
      for (let i = 0; i < stepped.fires; i++) this.game.action('down')
    }
  }
}
