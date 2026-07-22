/**
 * The vocabulary of key bindings: which actions are rebindable, what they're
 * called, and how a raw `KeyboardEvent.key` is canonicalised and labelled.
 *
 * Deliberately separate from the store in `settings.ts` — this is what a
 * binding *is*; that is which bindings the user currently has.
 */

/** Every rebindable action. Order is the order shown in the settings screen. */
export const BINDS = ['left', 'right', 'softDrop', 'hardDrop', 'rotateRight', 'rotateLeft', 'hold', 'pause'] as const

export type Bind = (typeof BINDS)[number]

export const BIND_LABELS: Record<Bind, string> = {
  left: 'Move left',
  right: 'Move right',
  softDrop: 'Soft drop',
  hardDrop: 'Hard drop',
  rotateRight: 'Rotate right',
  rotateLeft: 'Rotate left',
  hold: 'Hold',
  pause: 'Pause'
}

/** Visual grouping for the settings screen — purely presentational. */
export const BIND_GROUPS: readonly { label: string; binds: readonly Bind[] }[] = [
  { label: 'Movement', binds: ['left', 'right', 'softDrop', 'hardDrop'] },
  { label: 'Rotation', binds: ['rotateRight', 'rotateLeft'] },
  { label: 'Game', binds: ['hold', 'pause'] }
]

export type Keymap = Record<Bind, string[]>

export const DEFAULT_KEYS: Keymap = {
  left: ['ArrowLeft', 'a'],
  right: ['ArrowRight', 'd'],
  softDrop: ['ArrowDown', 's'],
  hardDrop: [' '],
  rotateRight: ['ArrowUp', 'x'],
  rotateLeft: ['z', 'Control'],
  hold: ['Shift', 'c'],
  pause: ['Escape', 'p']
}

/**
 * Canonical form of a `KeyboardEvent.key`. Printable keys are folded to
 * lowercase so a binding matches regardless of Shift/CapsLock; named keys
 * (`ArrowLeft`, `Escape`, …) are already unambiguous.
 */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

const KEY_GLYPHS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ' ': 'Space',
  Escape: 'Esc',
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: '⌫'
}

/** Human-readable label for a stored key, as shown on a keycap. */
export function keyLabel(key: string): string {
  return KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/**
 * Keys the rebind capture refuses: Enter and Escape drive the menu itself
 * (confirm / cancel), and the rest never produce a usable binding.
 */
const UNBINDABLE = new Set(['Enter', 'Tab', 'Dead', 'Unidentified'])

export function isBindable(key: string): boolean {
  return !UNBINDABLE.has(key)
}
