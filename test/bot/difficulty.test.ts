import { describe, it, expect } from 'vitest'
import { DIFFICULTY_CONFIG, createBotStrategy } from '../../renderer/src/bot/difficulty'
import { HeuristicStrategy } from '../../renderer/src/bot/strategy'

describe('DIFFICULTY_CONFIG', () => {
  it('slows down as difficulty decreases', () => {
    expect(DIFFICULTY_CONFIG.easy.actionDelayMs).toBeGreaterThan(DIFFICULTY_CONFIG.normal.actionDelayMs)
    expect(DIFFICULTY_CONFIG.normal.actionDelayMs).toBeGreaterThan(DIFFICULTY_CONFIG.hard.actionDelayMs)
  })

  it('only Hard looks ahead at the next piece', () => {
    expect(DIFFICULTY_CONFIG.easy.lookahead).toBe(false)
    expect(DIFFICULTY_CONFIG.normal.lookahead).toBe(false)
    expect(DIFFICULTY_CONFIG.hard.lookahead).toBe(true)
  })

  it('gets less willing to deviate from the best placement as difficulty rises', () => {
    expect(DIFFICULTY_CONFIG.easy.noise).toBeGreaterThan(DIFFICULTY_CONFIG.normal.noise)
    expect(DIFFICULTY_CONFIG.normal.noise).toBeGreaterThanOrEqual(DIFFICULTY_CONFIG.hard.noise)
    expect(DIFFICULTY_CONFIG.hard.noise).toBe(0)
  })

  it('only Hard considers hold', () => {
    expect(DIFFICULTY_CONFIG.easy.considerHold).toBe(false)
    expect(DIFFICULTY_CONFIG.normal.considerHold).toBe(false)
    expect(DIFFICULTY_CONFIG.hard.considerHold).toBe(true)
  })
})

describe('createBotStrategy', () => {
  it('builds a HeuristicStrategy for every difficulty', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      expect(createBotStrategy(difficulty, () => 0)).toBeInstanceOf(HeuristicStrategy)
    }
  })
})
