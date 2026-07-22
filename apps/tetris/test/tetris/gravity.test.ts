import { describe, it, expect } from 'vitest'
import { Gravity, gravityInterval } from '../../renderer/src/app/loop'
import Game from '@tetris/engine/Game'
import Piece from '@tetris/engine/Piece'

describe('Gravity', () => {
  it('gravityInterval shortens with level and floors at 70 ms', () => {
    expect(gravityInterval(1)).toBe(800)
    expect(gravityInterval(2)).toBeLessThan(800)
    expect(gravityInterval(50)).toBe(70)
  })

  it('ticks the engine once the level interval elapses', () => {
    const game = new Game({ width: 6, height: 10 })
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 2
    game.activePiece.y = 0
    const gravity = new Gravity()

    gravity.update(0.1, game) // 100 ms < 800 ms at level 1
    expect(game.activePiece.y).toBe(0)

    gravity.update(0.7, game) // total 800 ms
    expect(game.activePiece.y).toBe(1)
  })

  it('caps accumulated steps so a long stall cannot dump many rows', () => {
    const game = new Game({ width: 6, height: 20 })
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 2
    game.activePiece.y = 0
    const gravity = new Gravity()

    gravity.update(10, game) // would be many steps without the cap of 6
    expect(game.activePiece?.y).toBe(6)
  })

  it('reset clears the accumulator', () => {
    const game = new Game({ width: 6, height: 10 })
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.y = 0
    const gravity = new Gravity()
    gravity.update(0.79, game)
    gravity.reset()
    gravity.update(0.79, game)
    expect(game.activePiece.y).toBe(0)
  })
})
