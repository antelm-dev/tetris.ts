import type { Game, Action } from '../tetris'

/** Keys that fire once per press (rotations, hard drop, hold, pause, restart). */
const TAP: Record<string, Action> = {
  ArrowUp: 'rotate-right',
  x: 'rotate-right',
  z: 'rotate-left',
  Control: 'rotate-left',
  ' ': 'push',
  Shift: 'hold',
  c: 'hold',
  Escape: 'pause',
  p: 'pause'
}

const LEFT_KEYS = ['ArrowLeft', 'a']
const RIGHT_KEYS = ['ArrowRight', 'd']
const DOWN_KEYS = ['ArrowDown', 's']

const DAS = 150 // ms before horizontal auto-shift kicks in
const ARR = 38 // ms between auto-shifted steps
const SOFT_DROP = 45 // ms between soft-drop steps

/**
 * Frame-rate-independent input with real DAS/ARR timing. Taps are dispatched on
 * keydown; horizontal movement and soft-drop auto-repeat on independent
 * millisecond clocks advanced by the render loop via {@link update}, so holding
 * soft-drop never cancels a held horizontal shift.
 */
export class Input {
  private readonly down = new Set<string>()
  private hTimer = 0
  private hRepeating = false
  private hLast: 'left' | 'right' | undefined
  private vTimer = 0

  constructor(private readonly game: Game) {}

  public attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  public detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key
    const known = key in TAP || this.isMove(key)
    if (known) e.preventDefault()
    if (this.down.has(key)) return // ignore OS key-repeat
    this.down.add(key)

    if (key in TAP && !e.repeat) this.game.action(TAP[key])

    if (LEFT_KEYS.includes(key) || RIGHT_KEYS.includes(key)) {
      const dir = LEFT_KEYS.includes(key) ? 'left' : 'right'
      this.hLast = dir
      this.hTimer = 0
      this.hRepeating = false
      this.game.action(dir) // immediate first step
    }
    if (DOWN_KEYS.includes(key)) {
      this.vTimer = 0
      this.game.action('down')
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.key)
    this.hLast = this.currentHorizontal
    if (!this.hLast) this.hRepeating = false
  }

  private readonly onBlur = (): void => {
    this.down.clear()
    this.hRepeating = false
    this.hLast = undefined
  }

  private isMove(key: string): boolean {
    return LEFT_KEYS.includes(key) || RIGHT_KEYS.includes(key) || DOWN_KEYS.includes(key)
  }

  /** Whichever horizontal direction is currently held (right wins ties). */
  private get currentHorizontal(): 'left' | 'right' | undefined {
    const left = LEFT_KEYS.some((k) => this.down.has(k))
    const right = RIGHT_KEYS.some((k) => this.down.has(k))
    if (left && right) return this.hLast // keep the most recent
    if (left) return 'left'
    if (right) return 'right'
    return undefined
  }

  private get downHeld(): boolean {
    return DOWN_KEYS.some((k) => this.down.has(k))
  }

  /** Advance auto-repeat by `dt` seconds. Call once per rendered frame. */
  public update(dt: number): void {
    const ms = dt * 1000

    const dir = this.currentHorizontal
    if (dir) {
      this.hTimer += ms
      const threshold = this.hRepeating ? ARR : DAS
      while (this.hTimer >= threshold) {
        this.hTimer -= threshold
        this.game.action(dir)
        this.hRepeating = true
      }
    }

    if (this.downHeld) {
      this.vTimer += ms
      while (this.vTimer >= SOFT_DROP) {
        this.vTimer -= SOFT_DROP
        this.game.action('down')
      }
    }
  }
}
