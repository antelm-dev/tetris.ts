import { describe, it, expect } from 'vitest'
import Piece from '../../renderer/src/tetris/classes/Piece'

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

  it('rotates a T clockwise', () => {
    const piece = new Piece('T', [
      [1, 1, 1],
      [0, 1, 0]
    ])
    piece.rotate('right')
    expect(piece.shape).toEqual([
      [0, 1],
      [1, 1],
      [0, 1]
    ])
  })

  it('rotate left is the inverse of rotate right', () => {
    const original = [
      [1, 1, 1],
      [1, 0, 0]
    ]
    const piece = new Piece('L', original)
    piece.rotate('right')
    piece.rotate('left')
    expect(piece.shape).toEqual(original)
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
