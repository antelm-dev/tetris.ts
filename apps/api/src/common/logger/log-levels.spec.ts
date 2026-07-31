import { describe, expect, it } from 'vitest'
import { levelsFor } from './log-levels'

describe('levelsFor', () => {
  it('enables the threshold and everything less verbose', () => {
    expect(levelsFor('warn')).toEqual(['fatal', 'error', 'warn'])
    expect(levelsFor('fatal')).toEqual(['fatal'])
  })

  it('enables every level at the most verbose threshold', () => {
    expect(levelsFor('verbose')).toEqual(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])
  })

  it('falls back to `log` rather than disabling everything', () => {
    expect(levelsFor('nonsense' as never)).toEqual(['fatal', 'error', 'warn', 'log'])
  })

  it('always keeps fatal enabled', () => {
    for (const level of ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const) {
      expect(levelsFor(level)).toContain('fatal')
    }
  })
})
