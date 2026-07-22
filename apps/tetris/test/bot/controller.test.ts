import { describe, it, expect } from 'vitest'
import Game from '@tetris/engine/Game'
import Piece from '@tetris/engine/Piece'
import { PIECES_SHAPES } from '@tetris/engine/const'
import { BotController } from '@tetris/bot/controller'
import type { BotMove, BotStrategy } from '@tetris/bot/types'

function fixedStrategy(move: BotMove): BotStrategy {
  return { chooseMove: () => move }
}

/** Run enough `update` ticks (well past `delayMs` each) for the piece to lock. */
function runUntilLocked(game: Game, controller: BotController, maxTicks: number): void {
  for (let i = 0; i < maxTicks && game.activePiece; i++) controller.update(0.05)
}

describe('BotController', () => {
  it('drives the piece to the target column purely through game.action, then hard-drops', () => {
    const game = new Game({ width: 10, height: 20 })
    game.activePiece = new Piece('O', PIECES_SHAPES.O)
    game.activePiece.x = 4
    game.activePiece.y = 0

    const actions: string[] = []
    const originalAction = game.action.bind(game)
    game.action = (name) => {
      actions.push(name)
      originalAction(name)
    }

    const controller = new BotController(game, fixedStrategy({ rotation: 0, x: 2 }), 10)
    runUntilLocked(game, controller, 20)

    expect(game.activePiece).toBeUndefined()
    expect(game.field.slots[19][2]).toBe('O')
    expect(game.field.slots[19][3]).toBe('O')
    // Every state change went through the ordinary action channel — no direct
    // field/activePiece mutation.
    expect(actions).toContain('left')
    expect(actions).toContain('push')
  })

  it('rotates toward the target orientation before aligning x', () => {
    const game = new Game({ width: 10, height: 20 })
    game.activePiece = new Piece('T', PIECES_SHAPES.T)
    game.activePiece.x = 4
    game.activePiece.y = 0

    const controller = new BotController(game, fixedStrategy({ rotation: 2, x: 4 }), 10)
    controller.update(0.05) // one action tick

    expect(game.activePiece?.orientation).not.toBe(0)
  })

  it('replans and eventually locks a legal placement after an unreachable target', () => {
    const game = new Game({ width: 10, height: 20 })
    game.activePiece = new Piece('O', PIECES_SHAPES.O)
    game.activePiece.x = 4
    game.activePiece.y = 0

    let calls = 0
    const strategy: BotStrategy = {
      chooseMove: () => {
        calls++
        // First target is unreachable (off the left edge); once the
        // controller gets stuck and replans, hand it something legal.
        return calls === 1 ? { rotation: 0, x: -5 } : { rotation: 0, x: 2 }
      }
    }

    const controller = new BotController(game, strategy, 10)
    runUntilLocked(game, controller, 60)

    expect(calls).toBeGreaterThan(1) // it actually replanned
    expect(game.activePiece).toBeUndefined() // and still locked something
    expect(game.field.slots[19][2]).toBe('O')
    expect(game.field.slots[19][3]).toBe('O')
  })

  it('onSpawn/onLock clear the current target so the next piece gets a fresh plan', () => {
    const game = new Game({ width: 10, height: 20 })
    game.activePiece = new Piece('O', PIECES_SHAPES.O)
    game.activePiece.x = 4
    game.activePiece.y = 0

    let calls = 0
    const strategy: BotStrategy = {
      chooseMove: () => {
        calls++
        return { rotation: 0, x: 2 }
      }
    }
    const controller = new BotController(game, strategy, 10)
    controller.update(0.05)
    expect(calls).toBe(1)

    controller.onSpawn()
    controller.update(0.05)
    expect(calls).toBe(2) // replanned because onSpawn discarded the old target
  })
})
