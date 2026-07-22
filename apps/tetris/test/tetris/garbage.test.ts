import { describe, it, expect } from 'vitest'
import Field from '@tetris/engine/Field'
import { computeAttack } from '@tetris/engine/garbage'
import { mulberry32 } from '../../renderer/src/core/random'

describe('computeAttack', () => {
  it('matches the attack table for plain clears', () => {
    expect(computeAttack(1, false)).toBe(0) // single
    expect(computeAttack(2, false)).toBe(1) // double
    expect(computeAttack(3, false)).toBe(2) // triple
    expect(computeAttack(4, false)).toBe(4) // tetris
  })

  it('matches the attack table for spin clears', () => {
    expect(computeAttack(1, true)).toBe(2) // T-spin single
    expect(computeAttack(2, true)).toBe(4) // T-spin double
    expect(computeAttack(3, true)).toBe(6) // T-spin triple
  })

  it('sends nothing for no lines cleared, spin or not', () => {
    expect(computeAttack(0, false)).toBe(0)
    expect(computeAttack(0, true)).toBe(0)
  })
})

describe('Field.addGarbage', () => {
  it('leaves exactly one hole per pushed row', () => {
    const field = new Field({ width: 6, height: 10 })
    field.addGarbage(3, mulberry32(1))

    const garbageRows = field.slots.slice(-3)
    for (const row of garbageRows) {
      const holes = row.filter((c) => c === 0).length
      const filled = row.filter((c) => c === 'GARBAGE').length
      expect(holes).toBe(1)
      expect(filled).toBe(row.length - 1)
    }
  })

  it('shifts existing rows up and appends new rows at the bottom', () => {
    const field = new Field({ width: 4, height: 4 })
    field.slots[3][0] = 'O' // bottom row, will shift up by one

    field.addGarbage(1, mulberry32(2))

    expect(field.slots[2][0]).toBe('O') // shifted up
    expect(field.slots).toHaveLength(4) // height preserved
    expect(field.slots[3].filter((c) => c === 'GARBAGE')).toHaveLength(3)
  })

  it('is deterministic for a given seed', () => {
    const a = new Field({ width: 6, height: 10 })
    const b = new Field({ width: 6, height: 10 })
    a.addGarbage(4, mulberry32(42))
    b.addGarbage(4, mulberry32(42))
    expect(a.slots).toEqual(b.slots)
  })

  it('reports a top-out when a filled row is pushed off the top', () => {
    const field = new Field({ width: 4, height: 3 })
    field.slots[0].fill('O') // top row occupied

    const toppedOut = field.addGarbage(1, mulberry32(3))

    expect(toppedOut).toBe(true)
  })

  it('does not report a top-out while the top rows stay empty', () => {
    const field = new Field({ width: 4, height: 10 })
    const toppedOut = field.addGarbage(3, mulberry32(4))
    expect(toppedOut).toBe(false)
  })
})
