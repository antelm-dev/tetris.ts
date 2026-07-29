import { describe, it, expect } from 'vitest'
import Game, { gravityIntervalMs } from '@tetris/engine/Game'
import Piece from '@tetris/engine/Piece'
import { PIECES_SHAPES } from '@tetris/engine/const'

describe('gravityIntervalMs', () => {
  it('shortens with level and floors at 70 ms', () => {
    expect(gravityIntervalMs(1)).toBe(800)
    expect(gravityIntervalMs(2)).toBeLessThan(800)
    expect(gravityIntervalMs(50)).toBe(70)
  })
})

describe('Game.advance', () => {
  it('uses milliseconds and falls one cell after the level interval', () => {
    const game = new Game({ width: 6, height: 10 })
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 2
    game.activePiece.y = 0

    game.advance(100) // 100 ms < 800 ms at level 1
    expect(game.activePiece.y).toBe(0)
    expect(game.elapsedMs).toBe(100)

    game.advance(700) // total 800 ms
    expect(game.activePiece.y).toBe(1)
    expect(game.elapsedMs).toBe(800)
  })

  it('caps gravity catch-up at six steps', () => {
    const game = new Game({ width: 6, height: 20 })
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 2
    game.activePiece.y = 0

    game.advance(10_000)
    expect(game.activePiece?.y).toBe(6)
  })

  it('locks a grounded piece after the 500 ms lock delay', () => {
    const game = new Game({ width: 6, height: 4 })
    // Fill everything but the bottom-left so an O at (0,2) is grounded.
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 6; x++) {
        if (!(y >= 2 && x < 2)) game.field.slots[y][x] = 'I'
      }
    }
    game.activePiece = new Piece('O', PIECES_SHAPES.O)
    game.activePiece.x = 0
    game.activePiece.y = 2

    game.advance(400)
    expect(game.activePiece).toBeDefined()
    game.advance(100)
    expect(game.activePiece).toBeUndefined()
  })

  it('applies explicit-hole garbage without consuming the bag RNG', () => {
    let rngCalls = 0
    const game = new Game({
      width: 4,
      height: 6,
      random: () => {
        rngCalls++
        return 0
      }
    })
    const callsBefore = rngCalls
    game.receiveGarbage([{ hole: 1 }, { hole: 2 }])
    expect(rngCalls).toBe(callsBefore)

    const bottom = game.field.slots.slice(-2)
    expect(bottom[0][1]).toBe(0)
    expect(bottom[0].filter((c) => c === 'GARBAGE')).toHaveLength(3)
    expect(bottom[1][2]).toBe(0)
  })
})

describe('Game.project', () => {
  it('exposes board and active piece without the future queue', () => {
    const game = new Game({ width: 4, height: 5, random: () => 0 })
    game.start()
    const projection = game.project()

    expect(projection.width).toBe(4)
    expect(projection.height).toBe(5)
    expect(projection.board).toHaveLength(5)
    expect(projection.board[0]).toHaveLength(4)
    expect(projection.activePiece).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        x: expect.any(Number),
        y: expect.any(Number),
        orientation: 0
      })
    )
    expect(projection).not.toHaveProperty('nextPieces')
    expect(projection).not.toHaveProperty('holdPiece')
    expect(projection.score).toBe(0)
    expect(projection.gameOver).toBe(false)

    // Mutating the projection must not mutate engine state.
    projection.board[0][0] = 'T'
    expect(game.field.slots[0][0]).toBe(0)
  })
})
