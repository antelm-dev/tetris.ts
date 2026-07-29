/**
 * Solo mode definitions — typed data, not scattered conditionals. Every place
 * that needs to know how a mode wins (a line target, a time limit, what a
 * record is ranked by) reads it from here rather than special-casing a mode
 * id somewhere else in the engine, HUD or persistence layer.
 */

export type ModeId = 'endless' | 'marathon' | 'sprint' | 'ultra'

export interface ModeTarget {
  /** Complete on reaching this many cleared lines. */
  lines?: number
  /** Complete on reaching this much active-gameplay time, in ms. */
  timeMs?: number
}

export interface ModeDef {
  id: ModeId
  name: string
  shortLabel: string
  description: string
  /** Small pill shown next to the mode in the Solo menu. */
  tag?: string
  target: ModeTarget
  /** What a completed run is ranked by for its persisted record. */
  emphasis: 'score' | 'time'
  /** How the HUD's secondary time stat should read while playing, if at all. */
  timeDisplay?: 'elapsed' | 'countdown'
}

export const MODES: Record<ModeId, ModeDef> = {
  endless: {
    id: 'endless',
    name: 'Endless',
    shortLabel: 'Endless',
    description: 'Play until game over.',
    target: {},
    emphasis: 'score'
  },
  marathon: {
    id: 'marathon',
    name: 'Marathon',
    shortLabel: 'Marathon',
    description: 'Clear 150 lines.',
    tag: '150 lines',
    target: { lines: 150 },
    emphasis: 'score'
  },
  sprint: {
    id: 'sprint',
    name: 'Sprint',
    shortLabel: 'Sprint',
    description: 'Clear 40 lines — lowest time wins.',
    tag: '40 lines',
    target: { lines: 40 },
    emphasis: 'time',
    timeDisplay: 'elapsed'
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra',
    shortLabel: 'Ultra',
    description: '3 minutes on the clock — highest score wins.',
    tag: '3:00',
    target: { timeMs: 180_000 },
    emphasis: 'score',
    timeDisplay: 'countdown'
  }
}

export const MODE_LIST: ModeDef[] = [MODES.endless, MODES.marathon, MODES.sprint, MODES.ultra]
