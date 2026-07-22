import { Game } from '@tetris/engine'
import { describe, expect, it } from 'vitest'
import { EngineGameSession } from './engine-game-session'

/**
 * Exercises the authoritative session against the REAL shared engine (Vitest
 * transforms the engine's TypeScript source), proving the server reuses the
 * game rules rather than duplicating them — and that the session's own concerns
 * (input sequencing, snapshots) sit cleanly on top.
 */
function seededGame(): Game {
  // Deterministic RNG so the run is reproducible — exactly what an authoritative
  // server relies on. `start()` spawns the first piece.
  let n = 0
  const game = new Game({ width: 10, height: 20, random: () => ((n = (n * 9301 + 49_297) % 233_280), n / 233_280) })
  game.start()
  return game
}

describe('EngineGameSession', () => {
  it('drives the real engine and snapshots its authoritative state', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)

    const snap = session.snapshot()
    expect(snap.userId).toBe('user-1')
    expect(snap.score).toBe(game.score)
    expect(snap.level).toBe(game.level)
    expect(session.isOver).toBe(game.gameOver)
  })

  it('forwards inputs to the engine in sequence order', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)
    const startX = game.activePiece?.x

    session.applyAction('right', 1)
    expect(game.activePiece?.x).toBe((startX ?? 0) + 1)
  })

  it('ignores stale or duplicate sequence numbers', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)
    const startX = game.activePiece?.x ?? 0

    session.applyAction('right', 5)
    const movedX = game.activePiece?.x
    // Lower/equal sequence must be dropped — no further movement.
    session.applyAction('right', 5)
    session.applyAction('right', 2)
    expect(game.activePiece?.x).toBe(movedX)
    expect(movedX).toBe(startX + 1)
  })
})
