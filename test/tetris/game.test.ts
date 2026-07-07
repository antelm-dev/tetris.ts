import { describe, it, expect } from 'vitest'
import Game from '../../renderer/src/tetris/classes/Game'
import Piece from '../../renderer/src/tetris/classes/Piece'

const newGame = () => new Game({ width: 6, height: 10 })

describe('Game', () => {
  it('initializes empty with a 4-piece queue', () => {
    const game = newGame()
    expect(game.score).toBe(0)
    expect(game.gameOver).toBe(false)
    expect(game.activePiece).toBeUndefined()
    expect(game.nextPieces).toHaveLength(4)
    expect(game.field.slots).toHaveLength(10)
  })

  it('spawns an active piece on the first update, keeping the queue full', () => {
    const game = newGame()
    game.update()
    expect(game.activePiece).toBeDefined()
    expect(game.nextPieces).toHaveLength(4)
  })

  it('drops the active piece by one row on update', () => {
    const game = newGame()
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 2
    game.activePiece.y = 0
    game.update()
    expect(game.activePiece?.y).toBe(1)
  })

  it('moves the active piece left/right, respecting walls', () => {
    const game = newGame()
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 0
    game.action('right')
    expect(game.activePiece?.x).toBe(1)
    game.action('left')
    game.action('left') // blocked by the wall
    expect(game.activePiece?.x).toBe(0)
  })

  it('hold stashes the active piece and cannot be repeated until the next lock', () => {
    const game = newGame()
    game.activePiece = new Piece('T', [
      [1, 1, 1],
      [0, 1, 0]
    ])
    game.hold()
    expect(game.holdPiece?.name).toBe('T')
    expect(game.activePiece).toBeDefined()
    const afterFirstHold = game.holdPiece
    game.hold() // no-op: already held this turn
    expect(game.holdPiece).toBe(afterFirstHold)
  })

  it('push hard-drops, locks the piece and clears hold', () => {
    const game = newGame()
    const piece = new Piece('O', [[1]])
    piece.x = 2
    piece.y = 0
    game.activePiece = piece
    game.push()
    expect(game.activePiece).toBeUndefined()
    // landed at the bottom row
    expect(game.field.slots[9][2]).toBe('O')
  })

  it('scores 100 for a single line clear', () => {
    const game = newGame()
    // fill the bottom row except the last column
    for (let x = 0; x < 5; x++) game.field.slots[9][x] = 'O'
    const piece = new Piece('O', [[1]])
    piece.x = 5
    piece.y = 0
    game.activePiece = piece
    game.push()
    expect(game.score).toBe(100)
    expect(game.streak).toBe(1)
  })

  it('ends the game when a new piece has nowhere to spawn', () => {
    const game = newGame()
    game.field.slots.forEach((row) => row.fill('O')) // board completely full
    game.update() // tries to spawn -> overlaps -> game over
    expect(game.gameOver).toBe(true)
  })

  it('restarts from game over on push', () => {
    const game = newGame()
    game.field.slots.forEach((row) => row.fill('O'))
    game.update()
    expect(game.gameOver).toBe(true)
    game.action('push')
    expect(game.gameOver).toBe(false)
    expect(game.score).toBe(0)
    expect(game.field.slots.flat().every((c) => c === 0)).toBe(true)
  })

  it('toggles pause, halting updates', () => {
    const game = newGame()
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.y = 0
    game.action('pause')
    expect(game.isPaused).toBe(true)
    game.update()
    expect(game.activePiece?.y).toBe(0) // no drop while paused
    game.action('pause')
    expect(game.isPaused).toBe(false)
  })
})
