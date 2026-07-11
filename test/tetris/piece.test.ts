import { describe, it, expect } from 'vitest'
import Piece from '../../renderer/src/engine/Piece'
import { PIECES_SHAPES, type PieceName } from '../../renderer/src/engine/const'

describe('Piece', () => {
  it('deep-copies the shape it is constructed with', () => {
    const shape = [
      [1, 1],
      [0, 1]
    ]
    const piece = new Piece('T', shape)
    shape[0][0] = 9
    expect(piece.shape[0][0]).toBe(1)
  })

  it('moves in each direction', () => {
    const piece = new Piece('O', [[1]])
    piece.move('right')
    expect([piece.x, piece.y]).toEqual([1, 0])
    piece.move('down')
    expect([piece.x, piece.y]).toEqual([1, 1])
    piece.move('left')
    expect([piece.x, piece.y]).toEqual([0, 1])
  })

  it('rotates a T clockwise about its centre, in place', () => {
    const piece = new Piece('T', PIECES_SHAPES.T)
    piece.rotate('right')
    // Nub was up, now points right — and the box has not moved.
    expect(piece.shape).toEqual([
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 0]
    ])
    expect(piece.orientation).toBe(1)
    expect([piece.x, piece.y]).toEqual([0, 0])
  })

  it('rotate left is the exact inverse of rotate right, for every piece', () => {
    for (const name of Object.keys(PIECES_SHAPES) as PieceName[]) {
      const piece = new Piece(name, PIECES_SHAPES[name])
      piece.rotate('right')
      piece.rotate('left')
      expect(piece.shape, name).toEqual(PIECES_SHAPES[name])
      expect(piece.orientation, name).toBe(0)
    }
  })

  it('four turns in the same direction return every piece to its spawn state', () => {
    for (const name of Object.keys(PIECES_SHAPES) as PieceName[]) {
      const piece = new Piece(name, PIECES_SHAPES[name])
      for (let i = 0; i < 4; i++) piece.rotate('right')
      expect(piece.shape, name).toEqual(PIECES_SHAPES[name])
      expect(piece.orientation, name).toBe(0)
    }
  })

  // The whole point of the square bounding box: a turn is a *rigid rotation
  // about a fixed pivot* (the centre of the box), not a reshuffle that drags
  // the piece across the board. The old non-square boxes drifted by up to 1.5
  // cells per turn — and by different amounts left vs right, which is precisely
  // what made spins work in one direction only.
  it('is a rigid rotation about the centre of its box', () => {
    for (const name of Object.keys(PIECES_SHAPES) as PieceName[]) {
      for (const dir of ['right', 'left'] as const) {
        const piece = new Piece(name, PIECES_SHAPES[name])
        piece.x = 4
        piece.y = 5
        // The pivot: the box's centre, which stays put across the turn.
        const size = piece.shape.length
        const px = piece.x + (size - 1) / 2
        const py = piece.y + (size - 1) / 2
        const before = piece.cells()
        piece.rotate(dir)
        const after = new Set(piece.cells().map(([x, y]) => `${x},${y}`))

        // Every old cell, spun a quarter-turn about that pivot, must land on a
        // new cell — nothing translated, nothing lost.
        for (const [x, y] of before) {
          const dx = x - px
          const dy = y - py
          const [rx, ry] = dir === 'right' ? [-dy, dx] : [dy, -dx]
          expect(after, `${name} ${dir} (${x},${y})`).toContain(
            `${px + rx},${py + ry}`
          )
        }
      }
    }
  })

  it('clone is an independent copy', () => {
    const piece = new Piece('I', [[1, 1, 1, 1]])
    piece.x = 3
    piece.y = 5
    const clone = piece.clone()
    expect([clone.x, clone.y]).toEqual([3, 5])
    clone.move('down')
    clone.shape[0][0] = 0
    expect(piece.y).toBe(5)
    expect(piece.shape[0][0]).toBe(1)
  })
})
