import { settings } from '../config/settings'
import type { Bind } from '../config/keymap'
import type { Input } from './Input'

const BUTTONS: readonly { bind: Bind; label: string; title: string; group: 'move' | 'action' }[] = [
  { bind: 'left', label: '←', title: 'Move left', group: 'move' },
  { bind: 'right', label: '→', title: 'Move right', group: 'move' },
  { bind: 'softDrop', label: '↓', title: 'Soft drop', group: 'move' },
  { bind: 'hardDrop', label: '⇩', title: 'Hard drop', group: 'move' },
  { bind: 'rotateLeft', label: '↶', title: 'Rotate left', group: 'action' },
  { bind: 'rotateRight', label: '↷', title: 'Rotate right', group: 'action' },
  { bind: 'hold', label: 'H', title: 'Hold', group: 'action' },
  { bind: 'pause', label: 'Ⅱ', title: 'Pause', group: 'action' }
]

/** DOM touch overlay used only by the web entry point. */
export class TouchControls {
  private readonly el = document.createElement('div')
  private target?: Input
  private readonly unsubscribe: () => void

  constructor(parent: HTMLElement) {
    this.el.className = 'touch-controls'
    this.el.setAttribute('aria-label', 'Touch controls')
    const groups = {
      move: document.createElement('div'),
      action: document.createElement('div')
    }
    groups.move.className = 'touch-group touch-group-move'
    groups.action.className = 'touch-group touch-group-action'
    for (const item of BUTTONS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `touch-control touch-${item.bind}`
      button.textContent = item.label
      button.title = item.title
      button.setAttribute('aria-label', item.title)
      const source = `touch:${item.bind}`
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        this.target?.press(item.bind, source)
      })
      const release = (event: PointerEvent): void => {
        event.preventDefault()
        this.target?.release(item.bind, source)
      }
      button.addEventListener('pointerup', release)
      button.addEventListener('pointercancel', release)
      button.addEventListener('lostpointercapture', release)
      groups[item.group].append(button)
    }
    this.el.append(groups.move, groups.action)
    parent.append(this.el)
    this.unsubscribe = settings.subscribe(() => this.sync())
    this.sync()
  }

  public show(target: Input): void {
    this.target = target
    this.el.classList.add('is-playing')
    this.sync()
  }

  public hide(): void {
    this.target = undefined
    this.el.classList.remove('is-playing')
  }

  public dispose(): void {
    this.hide()
    this.unsubscribe()
    this.el.remove()
  }

  private sync(): void {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const enabled = settings.touchControls === 'on' || (settings.touchControls === 'auto' && coarse)
    this.el.classList.toggle('is-enabled', enabled)
    this.el.dataset.layout = settings.touchLayout
  }
}
