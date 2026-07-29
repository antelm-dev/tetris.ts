import { describe, it, expect } from 'vitest'
import Field from '@tetris/engine/Field'
import {
  aggregateHeight,
  bumpiness,
  columnHeights,
  countHoles,
  evaluateField,
  maxHeight,
  wells
} from '@tetris/bot/evaluate'

describe('columnHeights / aggregateHeight / maxHeight', () => {
  it('measures each column from its topmost filled cell to the floor', () => {
    const field = new Field({ width: 3, height: 5 })
    field.slots[4][0] = 'O' // column 0: height 1
    field.slots[3][1] = 'O'
    field.slots[4][1] = 'O' // column 1: height 2
    // column 2 stays empty: height 0

    expect(columnHeights(field)).toEqual([1, 2, 0])
    expect(aggregateHeight(field)).toBe(3)
    expect(maxHeight(field)).toBe(2)
  })

  it('is all zero for an empty field', () => {
    const field = new Field({ width: 4, height: 6 })
    expect(columnHeights(field)).toEqual([0, 0, 0, 0])
    expect(aggregateHeight(field)).toBe(0)
    expect(maxHeight(field)).toBe(0)
  })
})

describe('countHoles', () => {
  it('counts empty cells covered by a filled cell above them', () => {
    const field = new Field({ width: 2, height: 4 })
    field.slots[0][0] = 'O' // filled
    field.slots[1][0] = 0 // hole
    field.slots[2][0] = 0 // hole
    field.slots[3][0] = 'O' // filled, no cell below it in this column
    expect(countHoles(field)).toBe(2)
  })

  it('is zero when nothing is buried', () => {
    const field = new Field({ width: 3, height: 3 })
    field.slots[2].fill('O')
    expect(countHoles(field)).toBe(0)
  })
})

describe('bumpiness', () => {
  it('sums the absolute height difference between adjacent columns', () => {
    const field = new Field({ width: 4, height: 5 })
    // heights: [1, 3, 3, 0]
    field.slots[4][0] = 'O'
    field.slots[2][1] = 'O'
    field.slots[3][1] = 'O'
    field.slots[4][1] = 'O'
    field.slots[2][2] = 'O'
    field.slots[3][2] = 'O'
    field.slots[4][2] = 'O'
    expect(columnHeights(field)).toEqual([1, 3, 3, 0])
    expect(bumpiness(field)).toBe(2 + 0 + 3) // |1-3| + |3-3| + |3-0|
  })
})

describe('wells', () => {
  it('sums how far a column sits below both its neighbors', () => {
    const field = new Field({ width: 3, height: 5 })
    // heights: [3, 0, 3] — the middle column is a well 3 deep.
    for (let y = 2; y < 5; y++) field.slots[y][0] = 'O'
    for (let y = 2; y < 5; y++) field.slots[y][2] = 'O'
    expect(columnHeights(field)).toEqual([3, 0, 3])
    expect(wells(field)).toBe(3)
  })

  it('is zero on a flat board', () => {
    const field = new Field({ width: 3, height: 3 })
    field.slots[2].fill('O')
    expect(wells(field)).toBe(0)
  })
})

describe('evaluateField', () => {
  it('scores a hole-free board higher than an otherwise-identical board with a hole', () => {
    const flat = new Field({ width: 4, height: 5 })
    flat.slots[4].fill('O')

    const withHole = new Field({ width: 4, height: 5 })
    withHole.slots[4].fill('O')
    withHole.slots[4][2] = 0 // punch a hole
    withHole.slots[3][2] = 'O' // buried by a filled cell above it

    expect(evaluateField(flat, 0)).toBeGreaterThan(evaluateField(withHole, 0))
  })

  it('rewards cleared lines', () => {
    const field = new Field({ width: 4, height: 5 })
    expect(evaluateField(field, 4)).toBeGreaterThan(evaluateField(field, 0))
  })
})
