import { describe, it, expect } from 'vitest'
import {
  bestScoreOf,
  beatenBannerText,
  completionSubmission,
  EMPTY_RECORDS,
  gameOverSubmission
} from '../../renderer/src/app/records'

describe('gameOverSubmission', () => {
  it('submits a score-ranked record for Endless, Marathon and Ultra', () => {
    expect(gameOverSubmission('endless', 500, 1000)).toEqual({ mode: 'endless', score: 500 })
    expect(gameOverSubmission('marathon', 500, 1000)).toEqual({ mode: 'marathon', score: 500, elapsedMs: 1000 })
    expect(gameOverSubmission('ultra', 500, 1000)).toEqual({ mode: 'ultra', score: 500 })
  })

  it('never submits for Sprint — its time is only meaningful on a successful completion', () => {
    expect(gameOverSubmission('sprint', 500, 1000)).toBeUndefined()
  })
})

describe('completionSubmission', () => {
  it('submits a time-ranked record for Sprint', () => {
    expect(completionSubmission('sprint', 500, 32_400)).toEqual({ mode: 'sprint', timeMs: 32_400 })
  })

  it('submits a score-ranked record for Marathon and Ultra', () => {
    expect(completionSubmission('marathon', 900, 60_000)).toEqual({ mode: 'marathon', score: 900, elapsedMs: 60_000 })
    expect(completionSubmission('ultra', 900, 60_000)).toEqual({ mode: 'ultra', score: 900 })
  })

  it('Endless never completes, so it never submits a completion record', () => {
    expect(completionSubmission('endless', 900, 60_000)).toBeUndefined()
  })
})

describe('bestScoreOf', () => {
  it('reads the score field for score-ranked modes', () => {
    const records = { ...EMPTY_RECORDS, endless: { score: 42 } }
    expect(bestScoreOf(records, 'endless')).toBe(42)
  })

  it('is 0 for a mode with no record yet, or for Sprint (ranked by time, not score)', () => {
    expect(bestScoreOf(EMPTY_RECORDS, 'endless')).toBe(0)
    expect(bestScoreOf({ ...EMPTY_RECORDS, sprint: { timeMs: 5000 } }, 'sprint')).toBe(0)
  })
})

describe('beatenBannerText', () => {
  it('emphasizes time for Sprint', () => {
    const records = { ...EMPTY_RECORDS, sprint: { timeMs: 32_400 } }
    expect(beatenBannerText('sprint', records)).toBe('New best time: 0:32.4')
  })

  it('emphasizes score for every other mode', () => {
    const records = { ...EMPTY_RECORDS, ultra: { score: 12345 } }
    expect(beatenBannerText('ultra', records)).toBe('New high score: 12345')
  })
})
