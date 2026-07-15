import type { Bind } from '../../config/keymap'
import type { BotDifficulty } from '../../bot/types'
import type { ModeId } from '../../engine/modes'

export type Screen = 'main' | 'solo' | 'settings' | 'versus'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type RowId =
  | 'solo'
  | 'versus'
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
  | 'versus:difficulty'
  | 'versus:start'
  | 'versus:back'
  | `mode:${ModeId}`

export interface Row {
  id: RowId
  label: string
  /** How the right-hand side of the row renders and what Enter/←/→ do. */
  kind: 'action' | 'theme' | 'bind' | 'stepper' | 'toggle'
  disabled?: boolean
  /** Small pill on the right — e.g. a Solo mode's line/time target. */
  tag?: string
  bind?: Bind
  /** `primary` reads as the main CTA (Solo); `secondary` recedes a row that's still enabled but not the focus. */
  emphasis?: 'primary' | 'secondary'
}

export type Entry = { kind: 'heading'; label: string } | { kind: 'gap'; h: number } | { kind: 'row'; row: Row }

export interface MenuHandlers {
  /** Start (or restart) a single-player game in the chosen Solo mode. */
  onSelectMode: (mode: ModeId) => void
  /** Start a local Versus match against a bot at the chosen difficulty. */
  onVersus: (difficulty: BotDifficulty) => void
  /** Quit the app; the row is only shown when this is provided. */
  onQuit?: () => void
}
