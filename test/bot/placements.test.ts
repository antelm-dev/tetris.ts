import { describe, it, expect } from 'vitest'
import Field from '../../renderer/src/engine/Field'
import Piece from '../../renderer/src/engine/Piece'
import { PIECES_SHAPES, type PieceName } from '../../renderer/src/engine/const'
import { generatePlacements, simulatePlacement } from '../../renderer/src/bot/placements'

const ALL_PIECES = Object.keys(PIECES_SHAPES) as PieceName[]

/** A jagged 10-wide stack, deterministic in `seed` — no full rows, just uneven terrain. */
function jaggedStack(seed: number): Field {
  const field = new Field({ width: 10, height: 20 })
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let x = 0; x < 10; x++) {
    const height = 2 + Math.floor(rnd() * 6)
    for (let y = 20 - height; y < 20; y++) {
      if (x !== 4) field.slots[y][x] = 'L' // leave column 4 open so it's never a full row
    }
  }
  return field
}

describe('generatePlacements', () => {
  it('never returns a colliding placement, on an empty board', () => {
    const field = new Field({ width: 10, height: 20 })
    for (const name of ALL_PIECES) {
      const placements = generatePlacements(field, name)
      expect(placements.length).toBeGreaterThan(0)
      for (const placement of placements) {
        const piece = new Piece(name, placement.shape)
        piece.x = placement.x
        piece.y = placement.y
        expect(field.collides(piece)).toBe(false)
      }
    }
  })

  it('never returns a colliding placement, on a jagged stack', () => {
    const field = jaggedStack(7)
    for (const name of ALL_PIECES) {
      const placements = generatePlacements(field, name)
      for (const placement of placements) {
        const piece = new Piece(name, placement.shape)
        piece.x = placement.x
        piece.y = placement.y
        expect(field.collides(piece)).toBe(false)
      }
    }
  })

  it('every placement is actually resting — one more row down always collides', () => {
    const field = jaggedStack(11)
    const placements = generatePlacements(field, 'T')
    for (const placement of placements) {
      const piece = new Piece('T', placement.shape)
      piece.x = placement.x
      piece.y = placement.y + 1
      expect(field.collides(piece)).toBe(true)
    }
  })
})

describe('simulatePlacement', () => {
  it('does not mutate the live field', () => {
    const field = new Field({ width: 10, height: 20 })
    const before = field.slots.map((row) => [...row])

    const [placement] = generatePlacements(field, 'O')
    simulatePlacement(field, 'O', placement)

    expect(field.slots).toEqual(before)
  })

  it('returns a clone with the piece actually placed', () => {
    const field = new Field({ width: 10, height: 20 })
    const [placement] = generatePlacements(field, 'O')
    const { field: resultField } = simulatePlacement(field, 'O', placement)
    expect(resultField.isEmpty()).toBe(false)
    expect(field.isEmpty()).toBe(true)
  })

  it('reports cleared lines from the simulated placement', () => {
    // 4-wide well, bottom row filled except its rightmost two columns — an O
    // dropped at x=2 (columns 2,3) completes it.
    const field = new Field({ width: 4, height: 3 })
    field.slots[2][0] = 'O'
    field.slots[2][1] = 'O'
    const placements = generatePlacements(field, 'O').filter((p) => p.x === 2)
    expect(placements.length).toBeGreaterThan(0)
    const { result } = simulatePlacement(field, 'O', placements[0])
    expect(result.cleared).toBe(1)
  })
})
