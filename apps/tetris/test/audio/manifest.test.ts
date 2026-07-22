import { describe, it, expect } from 'vitest'
import { comboVoiceId, tierForLevel } from '../../renderer/src/audio/manifest'

describe('comboVoiceId', () => {
  it('maps 1..10 to the matching numbered voice line', () => {
    expect(comboVoiceId(1)).toBe('combo1')
    expect(comboVoiceId(7)).toBe('combo7')
    expect(comboVoiceId(10)).toBe('combo10')
  })

  it('clamps below 1 and above 10 to the pack bounds', () => {
    expect(comboVoiceId(0)).toBe('combo1')
    expect(comboVoiceId(-5)).toBe('combo1')
    expect(comboVoiceId(11)).toBe('combo10')
    expect(comboVoiceId(999)).toBe('combo10')
  })
})

describe('tierForLevel', () => {
  it('follows the ticket-specified progression', () => {
    expect(tierForLevel(1)).toBe(1)
    expect(tierForLevel(3)).toBe(1)
    expect(tierForLevel(4)).toBe(2)
    expect(tierForLevel(6)).toBe(2)
    expect(tierForLevel(7)).toBe(3)
    expect(tierForLevel(9)).toBe(3)
    expect(tierForLevel(10)).toBe(4)
    expect(tierForLevel(20)).toBe(4)
  })
})
