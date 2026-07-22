import { describe, it, expect } from 'vitest'
import Game from '@tetris/engine/Game'
import Piece from '@tetris/engine/Piece'
import { PIECES_SHAPES } from '@tetris/engine/const'
import { MODES } from '@tetris/engine/modes'

const newGame = (mode = MODES.endless) => new Game({ width: 10, height: 20, mode })

/**
 * Fill the bottom `rows` rows except the last column, then hard-drop a
 * vertical I into the gap — clearing `rows` lines at once (a Tetris at 4).
 * Mirrors the equivalent helper in `test/tetris/game.test.ts`.
 */
const clearLines = (game: Game, rows: number): void => {
  const h = game.field.slots.length
  for (let r = h - rows; r < h; r++) for (let x = 0; x < 9; x++) game.field.slots[r][x] = 'O'
  const piece = new Piece(
    'I',
    Array.from({ length: rows }, () => [1])
  )
  piece.x = 9
  piece.y = 0
  game.activePiece = piece
  game.push()
}

describe('Solo modes', () => {
  describe('Endless (default, regression)', () => {
    it('defaults to Endless when no mode is given', () => {
      const game = new Game({ width: 10, height: 20 })
      expect(game.mode).toBe(MODES.endless)
    })

    it('never completes, however many lines clear or however long it runs', () => {
      const game = newGame()
      game.start()
      clearLines(game, 4)
      game.tick(10_000) // far past every other mode's time target
      expect(game.completed).toBe(false)
    })

    it('still ends on top-out exactly as before', () => {
      const game = newGame()
      game.field.slots.forEach((row) => row.fill('O'))
      game.update()
      expect(game.gameOver).toBe(true)
      expect(game.completed).toBe(false)
    })
  })

  describe('Marathon (150 lines)', () => {
    it('completes on reaching the target', () => {
      const game = newGame(MODES.marathon)
      game.start()
      game.lines = 149
      clearLines(game, 1)
      expect(game.lines).toBe(150)
      expect(game.completed).toBe(true)
      expect(game.gameOver).toBe(false)
    })

    it('does not complete just short of the target', () => {
      const game = newGame(MODES.marathon)
      game.start()
      game.lines = 148
      clearLines(game, 1)
      expect(game.lines).toBe(149)
      expect(game.completed).toBe(false)
    })

    it('completes correctly when a multi-line clear jumps straight past the target', () => {
      const game = newGame(MODES.marathon)
      game.start()
      game.lines = 148
      clearLines(game, 4) // a Tetris: 148 -> 152, crossing 150 mid-clear
      expect(game.lines).toBe(152)
      expect(game.completed).toBe(true)
    })

    it('fires onComplete with the final score/time/lines — not onGameOver', () => {
      const game = newGame(MODES.marathon)
      game.start()
      game.lines = 149
      let completed: { score: number; elapsedMs: number; lines: number } | undefined
      let gameOver = false
      game.events.onComplete = (score, elapsedMs, lines) => (completed = { score, elapsedMs, lines })
      game.events.onGameOver = () => (gameOver = true)
      clearLines(game, 1)
      expect(completed).toEqual({ score: game.score, elapsedMs: game.elapsedMs, lines: 150 })
      expect(gameOver).toBe(false)
    })
  })

  describe('Sprint (40 lines)', () => {
    it('completes on reaching the target', () => {
      const game = newGame(MODES.sprint)
      game.start()
      game.lines = 39
      clearLines(game, 1)
      expect(game.completed).toBe(true)
    })

    it('does not complete just short of the target', () => {
      const game = newGame(MODES.sprint)
      game.start()
      game.lines = 38
      clearLines(game, 1)
      expect(game.completed).toBe(false)
    })

    it('completes correctly across a multi-line clear', () => {
      const game = newGame(MODES.sprint)
      game.start()
      game.lines = 38
      clearLines(game, 4)
      expect(game.lines).toBe(42)
      expect(game.completed).toBe(true)
    })
  })

  describe('Ultra (180 seconds)', () => {
    const ultraGame = (): Game => {
      const game = newGame(MODES.ultra)
      game.start()
      return game
    }

    it('completes after 180s of active gameplay, not before', () => {
      const game = ultraGame()
      game.tick(179)
      expect(game.completed).toBe(false)
      game.tick(1)
      expect(game.completed).toBe(true)
    })

    it('does not accumulate elapsed time while paused', () => {
      const game = ultraGame()
      game.action('pause')
      game.tick(200) // far past the 180s target
      expect(game.completed).toBe(false)
      expect(game.elapsedMs).toBe(0)
    })

    it('stops the clock once completed — further ticks are no-ops', () => {
      const game = ultraGame()
      game.tick(180)
      expect(game.completed).toBe(true)
      const elapsedAtCompletion = game.elapsedMs
      game.tick(10)
      expect(game.elapsedMs).toBe(elapsedAtCompletion)
    })

    it('fires onComplete once the clock runs out', () => {
      const game = ultraGame()
      let completed: { score: number; elapsedMs: number } | undefined
      game.events.onComplete = (score, elapsedMs) => (completed = { score, elapsedMs })
      game.tick(180)
      expect(completed?.elapsedMs).toBe(180_000)
    })
  })

  describe('completion vs. game over', () => {
    it('a lock-out always ends the game, never completes a mode', () => {
      const game = newGame(MODES.marathon)
      game.start()
      // Ground the O while its top row is still above the well — a lock-out,
      // per the existing `lock-out` engine tests.
      game.field.slots[0][4] = 'L'
      game.field.slots[0][5] = 'L'
      const piece = new Piece('O', PIECES_SHAPES.O)
      piece.x = 4
      piece.y = -2
      game.activePiece = piece
      game.push()
      expect(game.gameOver).toBe(true)
      expect(game.completed).toBe(false)
    })

    it('further actions/ticks are no-ops once completed, exactly like game over', () => {
      const game = newGame(MODES.sprint)
      game.start()
      game.lines = 39
      clearLines(game, 1)
      expect(game.completed).toBe(true)
      const linesAtCompletion = game.lines
      game.update()
      game.action('left')
      expect(game.lines).toBe(linesAtCompletion)
      expect(game.activePiece).toBeUndefined()
    })
  })

  describe('restart and mode switching', () => {
    it('restarting a completed run resets state but preserves the mode', () => {
      const game = newGame(MODES.sprint)
      game.start()
      game.lines = 39
      clearLines(game, 1)
      expect(game.completed).toBe(true)

      game.action('push') // the "Space to replay" convention, same as game over
      expect(game.completed).toBe(false)
      expect(game.gameOver).toBe(false)
      expect(game.lines).toBe(0)
      expect(game.elapsedMs).toBe(0)
      expect(game.mode).toBe(MODES.sprint)
    })

    it('restarting after game over also preserves the mode', () => {
      const game = newGame(MODES.marathon)
      game.field.slots.forEach((row) => row.fill('O'))
      game.update() // tries to spawn -> overlaps -> game over
      expect(game.gameOver).toBe(true)

      game.action('push')
      expect(game.gameOver).toBe(false)
      expect(game.mode).toBe(MODES.marathon)
    })

    it('switching mode before start() applies to the new run', () => {
      const game = newGame(MODES.endless)
      game.mode = MODES.marathon
      game.start()
      expect(game.mode).toBe(MODES.marathon)

      game.lines = 150
      game.tick(0) // re-run the completion check with no time elapsed
      expect(game.completed).toBe(true)
    })
  })
})
