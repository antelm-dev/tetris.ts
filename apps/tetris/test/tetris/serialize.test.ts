import { describe, it, expect } from 'vitest'
import Game from '@tetris/engine/Game'
import { mulberry32 } from '@tetris/engine/random'
import type { Action } from '@tetris/engine/types'

/**
 * `serialize`/`restore` are the foundation of rollback netcode: a restored game
 * must be indistinguishable from the original, *including* everything hidden —
 * the bag, the RNG position, the lock timers, the sub-cell gravity credit.
 *
 * A field missed by `serialize` typically survives a shallow equality check and
 * only shows up thousands of ticks later as a divergent board, so these tests
 * compare full future trajectories rather than just the captured snapshot.
 */

const mk = (seed = 42): Game => {
  const game = new Game({ width: 10, height: 20, random: mulberry32(seed) })
  game.start()
  return game
}

/** Everything observable about a game, as one comparable value. */
const fingerprint = (game: Game) => ({
  board: game.project().board,
  activePiece: game.project().activePiece,
  score: game.score,
  lines: game.lines,
  level: game.level,
  streak: game.streak,
  b2b: game.b2b,
  hold: game.holdPiece?.name,
  next: game.nextPieces.map((p) => p.name),
  over: game.gameOver
})

/** A scripted run long enough to exercise locks, clears, holds and level state. */
const SCRIPT: Action[] = ['left', 'rotate-right', 'right', 'down', 'push', 'hold', 'rotate-left', 'left', 'push']

function drive(game: Game, ticks: number, from = 0): void {
  for (let i = from; i < from + ticks; i++) {
    if (i % 7 === 0) game.action(SCRIPT[(i / 7) % SCRIPT.length])
    game.advance(16)
  }
}

describe('Game.serialize / restore', () => {
  it('round-trips to an identical observable state', () => {
    const game = mk()
    drive(game, 400)

    const restored = mk()
    restored.restore(game.serialize())

    expect(fingerprint(restored)).toEqual(fingerprint(game))
  })

  it('produces an identical future, not just an identical present', () => {
    const original = mk()
    drive(original, 400)

    const restored = mk()
    restored.restore(original.serialize())

    // Diverges here if anything hidden was missed: bag contents, RNG position,
    // gravityAccMs, lockTimer, lockResets, lowestRow, canHold, spin flags.
    drive(original, 600, 400)
    drive(restored, 600, 400)

    expect(fingerprint(restored)).toEqual(fingerprint(original))
  })

  it('rewinds the piece bag rather than re-shuffling it', () => {
    const game = mk()
    const state = game.serialize()
    // Burn through more than a full bag so a re-shuffle would be visible.
    drive(game, 1200)
    const afterFirstRun = game.nextPieces.map((p) => p.name)

    game.restore(state)
    drive(game, 1200)

    expect(game.nextPieces.map((p) => p.name)).toEqual(afterFirstRun)
  })

  it('restores a rotated active piece with its shape in step', () => {
    const game = mk()
    game.action('rotate-right')
    game.action('rotate-right')
    drive(game, 3)

    const restored = mk()
    restored.restore(game.serialize())

    expect(restored.activePiece?.orientation).toBe(game.activePiece?.orientation)
    expect(restored.activePiece?.shape).toEqual(game.activePiece?.shape)
  })

  it('fires no events while replaying', () => {
    const game = mk()
    let locks = 0
    game.events = { onLock: () => void locks++ }
    drive(game, 400)
    const during = locks

    game.replay(() => drive(game, 400, 400))
    expect(locks).toBe(during)

    // The hooks come back afterwards — `replay` borrows them, it does not eat them.
    drive(game, 400, 800)
    expect(locks).toBeGreaterThan(during)
  })
})
