import { BINDS, normalizeKey, type Bind } from '../config/keymap'
import { settings } from '../config/settings'
import type { Game, Action } from '@tetris/engine'
import { SOFT_DROP, resolveHorizontal, tickRepeat } from './timing'

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
  private readonly down = new Map<Bind, Set<string>>()
  private readonly gamepadSources = new Map<string, Bind>()
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
    this.clearHeld()
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
    const key = normalizeKey(e.key)
    const bind = this.map.get(key)
    if (!bind) return
    e.preventDefault()
    if (!e.repeat) this.press(bind, `key:${key}`)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const key = normalizeKey(e.key)
    const bind = this.map.get(key)
    if (!bind) return
    this.release(bind, `key:${key}`)
  }

  private readonly onBlur = (): void => {
    this.clearHeld()
  }

  private clearHeld(): void {
    this.down.clear()
    this.gamepadSources.clear()
    this.hRepeating = false
    this.hLast = undefined
  }

  /** Press/release are public so the web touch overlay can share the exact same repeat clocks. */
  public press(bind: Bind, source: string): void {
    let sources = this.down.get(bind)
    if (!sources) {
      sources = new Set()
      this.down.set(bind, sources)
    }
    if (sources.has(source)) return
    const alreadyHeld = sources.size > 0
    sources.add(source)
    if (alreadyHeld) return

    if (TAPS.has(bind)) {
      this.game.action(ACTIONS[bind])
      this.feedback(bind, source)
      return
    }
    if (bind === 'left' || bind === 'right') {
      this.hLast = bind
      this.hTimer = 0
      this.hRepeating = false
      this.game.action(ACTIONS[bind])
    } else if (bind === 'softDrop') {
      this.vTimer = 0
      this.game.action(ACTIONS[bind])
    }
  }

  public release(bind: Bind, source: string): void {
    const sources = this.down.get(bind)
    if (!sources) return
    sources.delete(source)
    if (sources.size > 0) return
    this.down.delete(bind)
    this.hLast = this.currentHorizontal
    if (!this.hLast) this.hRepeating = false
  }

  private held(bind: Bind): boolean {
    return (this.down.get(bind)?.size ?? 0) > 0
  }

  /** Whichever horizontal direction is currently held (most recent wins ties). */
  private get currentHorizontal(): 'left' | 'right' | undefined {
    return resolveHorizontal(this.held('left'), this.held('right'), this.hLast)
  }

  /** Advance auto-repeat by `dt` seconds. Call once per rendered frame. */
  public update(dt: number): void {
    this.pollGamepads()
    const ms = dt * 1000

    const dir = this.currentHorizontal
    if (dir) {
      const stepped = tickRepeat(
        { timer: this.hTimer, repeating: this.hRepeating },
        ms,
        true,
        settings.das,
        settings.arr
      )
      this.hTimer = stepped.state.timer
      this.hRepeating = stepped.state.repeating
      for (let i = 0; i < stepped.fires; i++) this.game.action(ACTIONS[dir])
    }

    if (this.held('softDrop')) {
      const stepped = tickRepeat({ timer: this.vTimer, repeating: true }, ms, true, SOFT_DROP, SOFT_DROP)
      this.vTimer = stepped.state.timer
      for (let i = 0; i < stepped.fires; i++) this.game.action('down')
    }
  }

  private pollGamepads(): void {
    if (typeof navigator.getGamepads !== 'function') return
    const next = new Map<string, Bind>()
    const add = (pad: Gamepad, bind: Bind, control: string, active: boolean): void => {
      if (active) next.set(`gamepad:${pad.index}:${control}`, bind)
    }
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue
      const button = (index: number): boolean => pad.buttons[index]?.pressed ?? false
      const axisX = pad.axes[0] ?? 0
      const axisY = pad.axes[1] ?? 0
      add(pad, 'left', 'left', button(14) || axisX < -0.55)
      add(pad, 'right', 'right', button(15) || axisX > 0.55)
      add(pad, 'softDrop', 'down', button(13) || axisY > 0.55)
      add(pad, 'hardDrop', 'up', button(12) || axisY < -0.7)
      add(pad, 'rotateRight', 'a', button(0))
      add(pad, 'rotateLeft', 'b', button(1) || button(2))
      add(pad, 'hold', 'hold', button(3) || button(4) || button(5))
      add(pad, 'pause', 'pause', button(9))
    }
    for (const [source, bind] of next) if (!this.gamepadSources.has(source)) this.press(bind, source)
    for (const [source, bind] of this.gamepadSources) if (!next.has(source)) this.release(bind, source)
    this.gamepadSources.clear()
    for (const item of next) this.gamepadSources.set(...item)
  }

  private feedback(bind: Bind, source: string): void {
    if (!settings.vibration || bind === 'pause' || (!source.startsWith('touch:') && !source.startsWith('gamepad:')))
      return
    const duration = bind === 'hardDrop' ? 24 : 12
    if (source.startsWith('touch:') && typeof navigator.vibrate === 'function') navigator.vibrate(duration)
    if (!source.startsWith('gamepad:') || typeof navigator.getGamepads !== 'function') return
    const index = Number(source.split(':')[1])
    type HapticActuator = {
      playEffect?: (type: string, params: object) => Promise<unknown>
      pulse?: (value: number, duration: number) => Promise<unknown>
    }
    const pad = navigator.getGamepads()[index] as
      | (Gamepad & {
          vibrationActuator?: HapticActuator
          hapticActuators?: HapticActuator[]
        })
      | null
    const actuator = pad?.vibrationActuator ?? pad?.hapticActuators?.[0]
    if (actuator?.playEffect) {
      void actuator
        .playEffect('dual-rumble', {
          duration,
          startDelay: 0,
          weakMagnitude: 0.18,
          strongMagnitude: bind === 'hardDrop' ? 0.22 : 0.08
        })
        .catch(() => {})
    } else {
      void actuator?.pulse?.(bind === 'hardDrop' ? 0.22 : 0.12, duration).catch(() => {})
    }
  }
}
