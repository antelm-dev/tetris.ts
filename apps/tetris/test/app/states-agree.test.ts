import { describe, it, expect } from 'vitest'
import Game from '@tetris/engine/Game'
import { mulberry32 } from '@tetris/engine/random'
import type { GameState } from '@tetris/engine/types'
import { statesAgree } from '@tetris/renderer/app/online'

/**
 * `statesAgree` decides whether an authoritative correction is discarded. A
 * field it fails to compare is a divergence the client throws away — the exact
 * failure the correction channel exists to prevent, made invisible.
 *
 * So rather than testing a hand-picked sample of fields, this walks *every* key
 * of a real serialized state and asserts each one is load-bearing. A future
 * field added to `GameState` is covered the moment it exists, with nobody
 * needing to remember to extend a list.
 */

function stateAfterPlay(): GameState {
  const game = new Game({ width: 10, height: 20, random: mulberry32(99) })
  game.start()
  for (let i = 0; i < 300; i++) {
    if (i % 11 === 0) game.action('rotate-right')
    if (i % 17 === 0) game.action('left')
    game.advance(16)
  }
  return game.serialize()
}

/** A different-but-valid value for whatever `value` is. */
function perturb(value: unknown): unknown {
  if (typeof value === 'number') return value + 1
  if (typeof value === 'boolean') return !value
  if (typeof value === 'string') return `${value}-changed`
  if (value === null || value === undefined) return 0
  if (Array.isArray(value)) return value.length > 0 ? value.slice(0, -1) : ['I']
  return { ...(value as object), x: Number.NaN }
}

describe('statesAgree', () => {
  it('accepts a state that is genuinely identical', () => {
    const state = stateAfterPlay()
    expect(statesAgree(state, structuredClone(state))).toBe(true)
  })

  it('rejects a difference in any single field of GameState', () => {
    const base = stateAfterPlay()
    const keys = Object.keys(base) as Array<keyof GameState>
    expect(keys.length).toBeGreaterThan(15)

    for (const key of keys) {
      const other = structuredClone(base) as Record<string, unknown>
      other[key] = perturb(other[key])
      expect(statesAgree(base, other as unknown as GameState), `field "${key}" is not compared`).toBe(false)
    }
  })

  it('rejects a single changed cell anywhere on the board', () => {
    const base = stateAfterPlay()
    const other = structuredClone(base)
    const y = other.board.length - 1
    other.board[y][0] = other.board[y][0] === 0 ? 'GARBAGE' : 0
    expect(statesAgree(base, other)).toBe(false)
  })

  it('rejects mismatched board dimensions', () => {
    const base = stateAfterPlay()
    const shortBoard = structuredClone(base)
    shortBoard.board = shortBoard.board.slice(1)
    expect(statesAgree(base, shortBoard)).toBe(false)

    const narrowRow = structuredClone(base)
    narrowRow.board[0] = narrowRow.board[0].slice(1)
    expect(statesAgree(base, narrowRow)).toBe(false)
  })

  it('rejects a difference inside the active piece', () => {
    const base = stateAfterPlay()
    expect(base.activePiece).toBeTruthy()
    const moved = structuredClone(base)
    moved.activePiece!.x += 1
    expect(statesAgree(base, moved)).toBe(false)

    const gone = structuredClone(base)
    gone.activePiece = undefined
    expect(statesAgree(base, gone)).toBe(false)
  })
})
