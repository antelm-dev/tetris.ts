import { describe, it, expect } from 'vitest'
import Field from '../../renderer/src/tetris/classes/Field'
import Piece from '../../renderer/src/tetris/classes/Piece'
import type { Slot } from '../../renderer/src/tetris/types'

const fill = (field: Field, rows: Slot[][]) => {
  rows.forEach((row, i) => row.forEach((cell, j) => (field.slots[i][j] = cell)))
}

describe('Field', () => {
  it('starts empty with the given dimensions', () => {
    const field = new Field({ width: 4, height: 3 })
    expect(field.slots).toHaveLength(3)
    expect(field.slots[0]).toHaveLength(4)
    expect(field.slots.flat().every((c) => c === 0)).toBe(true)
  })

  it('checkCollision detects the floor', () => {
    const field = new Field({ width: 4, height: 2 })
    const piece = new Piece('O', [[1]])
    piece.x = 0
    piece.y = 1 // bottom row
    expect(field.checkCollision(piece, 'down')).toBe(true)
  })

  it('checkCollision detects the side walls', () => {
    const field = new Field({ width: 4, height: 4 })
    const piece = new Piece('O', [[1]])
    piece.x = 0
    expect(field.checkCollision(piece, 'left')).toBe(true)
    piece.x = 3
    expect(field.checkCollision(piece, 'right')).toBe(true)
    piece.x = 1
    expect(field.checkCollision(piece, 'left')).toBe(false)
  })

  it('overlaps detects an existing block', () => {
    const field = new Field({ width: 4, height: 4 })
    field.slots[0][2] = 'O'
    const piece = new Piece('O', [[1]])
    piece.x = 2
    piece.y = 0
    expect(field.overlaps(piece)).toBe(true)
    piece.x = 1
    expect(field.overlaps(piece)).toBe(false)
  })

  it('placePiece clears a single completed row and returns 1', () => {
    const field = new Field({ width: 4, height: 3 })
    fill(field, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      ['O', 'O', 'O', 0]
    ])
    const piece = new Piece('O', [[1]])
    piece.x = 3
    piece.y = 2
    const cleared = field.placePiece(piece)
    expect(cleared).toBe(1)
    expect(field.slots.flat().every((c) => c === 0)).toBe(true)
  })

  it('placePiece returns 0 when nothing is completed', () => {
    const field = new Field({ width: 4, height: 3 })
    const piece = new Piece('O', [[1]])
    piece.x = 0
    piece.y = 2
    expect(field.placePiece(piece)).toBe(0)
    expect(field.slots[2][0]).toBe('O')
  })

  // Regression test: clearing multiple rows at once must not leave full rows
  // behind or destroy the wrong (surviving) row.
  it('clears TWO rows completed by one piece and preserves the row above', () => {
    const field = new Field({ width: 4, height: 5 })
    fill(field, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      ['S', 0, 0, 0], // survivor — must remain, shifted to the bottom
      ['O', 'O', 'O', 0], // completed by the piece
      ['O', 'O', 'O', 0] // completed by the piece
    ])
    // A vertical 2-cell piece filling the last column of the bottom two rows.
    const piece = new Piece('I', [[1], [1]])
    piece.x = 3
    piece.y = 3

    const cleared = field.placePiece(piece)

    expect(cleared).toBe(2)
    expect(field.slots.some((row) => row.every((c) => c !== 0))).toBe(false)
    expect(field.slots[4]).toEqual(['S', 0, 0, 0])
    // everything above the survivor is empty
    expect(field.slots.slice(0, 4).flat().every((c) => c === 0)).toBe(true)
  })

  it('reset empties the field', () => {
    const field = new Field({ width: 3, height: 3 })
    field.slots[0][0] = 'O'
    field.reset()
    expect(field.slots.flat().every((c) => c === 0)).toBe(true)
  })
})
