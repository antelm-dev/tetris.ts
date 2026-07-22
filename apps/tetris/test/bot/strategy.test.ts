import { describe, it, expect } from 'vitest'
import Game from '@tetris/engine/Game'
import Piece from '@tetris/engine/Piece'
import { PIECES_SHAPES } from '@tetris/engine/const'
import { HeuristicStrategy } from '@tetris/bot/strategy'

/**
 * A 3-wide, 4-tall well with column 0 raised by one block. Dropping the O
 * piece at x=0 rests on the raised column and buries a hole under column 1;
 * dropping it at x=1 rests flush on the floor and leaves no hole — the
 * unambiguous "safer placement" the heuristic should always prefer.
 */
function boardWithObviousChoice(): Game {
  const game = new Game({ width: 3, height: 4 })
  game.field.slots[3][0] = 'O'
  game.activePiece = new Piece('O', PIECES_SHAPES.O)
  game.activePiece.x = 0
  game.activePiece.y = 0
  return game
}

describe('HeuristicStrategy', () => {
  it('picks the hole-free placement over the hole-creating one when noise is 0', () => {
    const game = boardWithObviousChoice()
    const strategy = new HeuristicStrategy({ lookahead: false, considerHold: false, noise: 0, random: () => 0 })
    const move = strategy.chooseMove(game)
    expect(move).toEqual({ rotation: 0, x: 1 })
  })

  it('deviates from the best placement when noise forces it', () => {
    const game = boardWithObviousChoice()
    const best = new HeuristicStrategy({
      lookahead: false,
      considerHold: false,
      noise: 0,
      random: () => 0
    }).chooseMove(game)
    const deviated = new HeuristicStrategy({
      lookahead: false,
      considerHold: false,
      noise: 0.5,
      random: () => 0.1 // < noise, so the deviate branch always fires
    }).chooseMove(game)

    expect(deviated?.x).not.toBe(best?.x)
  })

  it('never picks the deviate branch when noise is 0, regardless of the injected random value', () => {
    const game = boardWithObviousChoice()
    const move = new HeuristicStrategy({
      lookahead: false,
      considerHold: false,
      noise: 0,
      random: () => 0.999
    }).chooseMove(game)
    expect(move).toEqual({ rotation: 0, x: 1 })
  })

  it('returns undefined when there is no active piece', () => {
    const game = new Game({ width: 10, height: 20 })
    const strategy = new HeuristicStrategy({ lookahead: false, considerHold: false, noise: 0, random: () => 0 })
    expect(strategy.chooseMove(game)).toBeUndefined()
  })

  it('lookahead evaluates the next piece without mutating the real queue or field', () => {
    const game = new Game({ width: 10, height: 20 })
    game.activePiece = new Piece('T', PIECES_SHAPES.T)
    game.activePiece.x = 3
    game.activePiece.y = 0
    const nextNamesBefore = game.nextPieces.map((p) => p.name)
    const fieldBefore = game.field.slots.map((row) => [...row])

    const strategy = new HeuristicStrategy({ lookahead: true, considerHold: false, noise: 0, random: () => 0 })
    const move = strategy.chooseMove(game)

    expect(move).toBeDefined()
    expect(game.nextPieces.map((p) => p.name)).toEqual(nextNamesBefore)
    expect(game.field.slots).toEqual(fieldBefore)
    expect(game.activePiece?.name).toBe('T')
  })
})
