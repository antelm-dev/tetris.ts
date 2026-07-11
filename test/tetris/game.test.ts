import { describe, it, expect } from 'vitest'
import Game from '../../renderer/src/engine/Game'
import Piece from '../../renderer/src/engine/Piece'

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

  it('wall-kicks a rotation that would otherwise collide with the floor', () => {
    const game = newGame()
    const piece = new Piece('T', [
      [1, 1, 1],
      [0, 1, 0]
    ])
    piece.x = 2
    piece.y = 8 // flat on the floor: a naive rotate would poke through it
    game.activePiece = piece
    game.action('rotate-right')
    // Rotated to the vertical T and kicked one row up to stay on the board.
    expect(game.activePiece?.shape).toEqual([
      [0, 1],
      [1, 1],
      [0, 1]
    ])
    expect(game.activePiece?.y).toBe(7)
    expect(game.activePiece?.x).toBe(2)
  })

  it('detects a T-spin: rotating into a wedged slot scores a spin and fires onSpin', () => {
    const game = newGame()
    // Build a 1-wide T-slot at the bottom, fully enclosed so the landed T
    // cannot shift in any direction (the generalized "immobile" spin rule).
    game.field.slots[6][1] = 'O' // overhang above the flat (blocks up)
    game.field.slots[7][0] = 'O' // wall left of the flat (blocks left)
    game.field.slots[7][4] = 'O' // wall right of the flat (blocks right)
    game.field.slots[9][2] = 'O' // floor under the nub (blocks down)

    // T pointing right; a clockwise rotation turns it into the spawn shape that
    // drops into the slot at (x=1, y=7) without needing a kick.
    const piece = new Piece('T', [
      [1, 0],
      [1, 1],
      [1, 0]
    ])
    piece.x = 1
    piece.y = 7
    game.activePiece = piece

    let spun: { name: string; lines: number } | undefined
    game.events.onSpin = (name, lines) => (spun = { name, lines })

    game.action('rotate-right')
    expect(game.activePiece?.shape).toEqual([
      [1, 1, 1],
      [0, 1, 0]
    ])
    game.push() // lock it in place

    expect(spun).toEqual({ name: 'T', lines: 0 })
    expect(game.score).toBe(100) // spin-without-clear bonus
  })

  it('scores a T-spin single higher than a normal single', () => {
    const game = newGame()
    // Same enclosed slot, but the flat row is one line away from complete so
    // locking the T clears it — a T-spin single (800) beats a plain single (100).
    game.field.slots[6][1] = 'O'
    game.field.slots[7][0] = 'O'
    game.field.slots[7][4] = 'O'
    game.field.slots[7][5] = 'O' // fill the last column so row 7 completes
    game.field.slots[9][2] = 'O'

    const piece = new Piece('T', [
      [1, 0],
      [1, 1],
      [1, 0]
    ])
    piece.x = 1
    piece.y = 7
    game.activePiece = piece

    game.action('rotate-right')
    game.push()

    expect(game.score).toBe(800)
    expect(game.lines).toBe(1)
  })

  it('does not count a spin when the last action was a move, not a rotation', () => {
    const game = newGame()
    game.field.slots[6][1] = 'O'
    game.field.slots[7][0] = 'O'
    game.field.slots[7][4] = 'O'
    game.field.slots[9][2] = 'O'

    // Already in the spawn shape and slot, but we nudge (a no-op against the
    // right wall) so the last action is a move -> the lock must not be a spin.
    const piece = new Piece('T', [
      [1, 1, 1],
      [0, 1, 0]
    ])
    piece.x = 1
    piece.y = 7
    game.activePiece = piece

    let spun = false
    game.events.onSpin = () => (spun = true)

    game.action('right') // blocked by the enclosing wall, but still a "move"
    game.push()

    expect(spun).toBe(false)
    expect(game.score).toBe(0)
  })

  // Fill the bottom `rows` completely except the last column, then hard-drop a
  // vertical I into that gap — clearing `rows` lines at once (a Tetris at 4).
  const dropIInto = (game: Game, rows: number): void => {
    const h = game.field.slots.length
    for (let r = h - rows; r < h; r++)
      for (let x = 0; x < 5; x++) game.field.slots[r][x] = 'O'
    const piece = new Piece(
      'I',
      Array.from({ length: rows }, () => [1])
    )
    piece.x = 5
    piece.y = 0
    game.activePiece = piece
    game.push()
  }

  // Fill the bottom row except the last column, then drop a 1×1 into the gap.
  const dropSingle = (game: Game): void => {
    const h = game.field.slots.length
    for (let x = 0; x < 5; x++) game.field.slots[h - 1][x] = 'O'
    const piece = new Piece('O', [[1]])
    piece.x = 5
    piece.y = 0
    game.activePiece = piece
    game.push()
  }

  it('rewards back-to-back Tetrises with a 1.5× bonus and fires onB2B', () => {
    const game = newGame()
    const chains: number[] = []
    game.events.onB2B = (chain) => chains.push(chain)

    dropIInto(game, 4) // first Tetris: opens the chain, no bonus yet
    const first = game.score
    expect(first).toBe(800)
    expect(game.b2b).toBe(1)
    expect(chains).toEqual([])

    dropIInto(game, 4) // second Tetris: back-to-back → 1.5× + combo bonus
    expect(game.b2b).toBe(2)
    expect(chains).toEqual([2])
    // 1200 (800 × 1.5) for the clear plus a combo bonus for the 2nd clear.
    expect(game.score).toBeGreaterThan(first + 1200 - 1)
  })

  it('breaks the back-to-back chain on a plain line clear', () => {
    const game = newGame()
    dropIInto(game, 4)
    expect(game.b2b).toBe(1)
    dropSingle(game) // a plain single — not difficult — resets the chain
    expect(game.b2b).toBe(0)
  })

  it('awards a combo bonus for consecutive clears and fires onCombo', () => {
    const game = newGame()
    const combos: number[] = []
    game.events.onCombo = (combo) => combos.push(combo)

    dropSingle(game) // first clear: combo 0, no bonus
    expect(game.score).toBe(100)
    expect(combos).toEqual([])

    dropSingle(game) // second clear: combo 1 → +50 × 1 × level
    expect(game.streak).toBe(2)
    expect(combos).toEqual([1])
    expect(game.score).toBe(100 + 100 + 50)
  })

  it('resets the combo when a drop clears no lines', () => {
    const game = newGame()
    dropSingle(game)
    expect(game.streak).toBe(1)
    // Park a piece off to the side so it locks without completing a row.
    const piece = new Piece('O', [[1]])
    piece.x = 0
    piece.y = 0
    game.activePiece = piece
    game.push()
    expect(game.streak).toBe(0)
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
