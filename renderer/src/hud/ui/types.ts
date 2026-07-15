import type { RGB } from '../../core/color'
import type { PieceName } from '../../engine'

export type StatKey = 'score' | 'best' | 'level' | 'lines'

export interface Stat {
  label: string
  value: string
  /** Decays 1 → 0; drives the brief scale/colour pulse on a value change. */
  bump: number
}

export interface OverlayState {
  title: string
  sub: string
  kind: 'pause' | 'over' | 'complete'
  shown: boolean
  t: number // eased opacity, 0 → 1
}

/** Draft filled by spin/clear/B2B/combo/PC hooks in one push, flushed in update. */
export interface MoveDraft {
  spin?: PieceName
  lines: number
  b2b: number
  combo: number
  perfectClear: boolean
  dirty: boolean
}

export interface MoveCallout {
  title: string
  sub: string
  b2b: number
  combo: number
  color: RGB
  life: number
  appear: number
  pop: number
}

export interface LegendEntry {
  keys: string[]
  label: string
  keyW: number[]
  width: number
}
