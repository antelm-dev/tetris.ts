import { describe, it, expect } from 'vitest'
import { ARR, DAS, SOFT_DROP, resolveHorizontal, tickRepeat } from '../../renderer/src/input/timing'

describe('resolveHorizontal', () => {
  it('returns the sole held direction', () => {
    expect(resolveHorizontal(true, false)).toBe('left')
    expect(resolveHorizontal(false, true)).toBe('right')
    expect(resolveHorizontal(false, false)).toBeUndefined()
  })

  it('keeps the most recent direction when both are held', () => {
    expect(resolveHorizontal(true, true, 'left')).toBe('left')
    expect(resolveHorizontal(true, true, 'right')).toBe('right')
  })

  it('falls back to the remaining key when one side is released', () => {
    expect(resolveHorizontal(true, false, 'right')).toBe('left')
    expect(resolveHorizontal(false, true, 'left')).toBe('right')
  })
})

describe('tickRepeat DAS/ARR', () => {
  it('waits for DAS before the first auto-repeat, then uses ARR', () => {
    let state = { timer: 0, repeating: false }

    let step = tickRepeat(state, DAS - 1, true, DAS, ARR)
    expect(step.fires).toBe(0)
    state = step.state

    step = tickRepeat(state, 1, true, DAS, ARR)
    expect(step.fires).toBe(1)
    expect(step.state.repeating).toBe(true)
    state = step.state

    step = tickRepeat(state, ARR * 3, true, DAS, ARR)
    expect(step.fires).toBe(3)
  })

  it('does not invent progress while released', () => {
    const held = tickRepeat({ timer: 40, repeating: false }, 20, true, DAS, ARR)
    const released = tickRepeat(held.state, 500, false, DAS, ARR)
    expect(released.fires).toBe(0)
    expect(released.state).toEqual(held.state)
  })

  it('soft-drop uses a single repeating interval', () => {
    const step = tickRepeat({ timer: 0, repeating: true }, SOFT_DROP * 2 + 10, true, SOFT_DROP, SOFT_DROP)
    expect(step.fires).toBe(2)
  })
})
