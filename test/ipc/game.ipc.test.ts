import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store, writeImpl } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  writeImpl: { fn: null as null | ((path: string, data: string) => Promise<void>) }
}))

vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    const value = store.get(path)
    if (value === undefined) throw new Error('ENOENT')
    return value
  },
  writeFile: async (path: string, data: string) => {
    if (writeImpl.fn) return writeImpl.fn(path, data)
    store.set(path, data)
  }
}))

import { gameIpc, isValidScore, parseHighScorePayload } from '../../main/ipc/game.ipc'
import { createFakeIpc } from './fake-ipc'

const load = async () => {
  const { ipc, handlers } = createFakeIpc()
  await gameIpc(ipc)
  const sender = { send: vi.fn() }
  const event = { sender } as never
  return {
    sender,
    getHighScore: () => handlers.get('game:get-high-score')!(event) as Promise<number>,
    submitScore: (score: unknown) => handlers.get('game:submit-score')!(event, score) as Promise<boolean>
  }
}

beforeEach(() => {
  store.clear()
  writeImpl.fn = null
})

describe('score validation', () => {
  it('accepts finite non-negative integers only', () => {
    expect(isValidScore(0)).toBe(true)
    expect(isValidScore(42)).toBe(true)
    expect(isValidScore(-1)).toBe(false)
    expect(isValidScore(1.5)).toBe(false)
    expect(isValidScore(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidScore(Number.NaN)).toBe(false)
    expect(isValidScore('10')).toBe(false)
    expect(isValidScore(null)).toBe(false)
  })

  it('parses high-score JSON defensively', () => {
    expect(parseHighScorePayload('{"highScore":900}')).toBe(900)
    expect(parseHighScorePayload('{"highScore":-3}')).toBe(0)
    expect(parseHighScorePayload('{"highScore":"nope"}')).toBe(0)
    expect(parseHighScorePayload('[]')).toBe(0)
    expect(parseHighScorePayload('not-json')).toBe(0)
    expect(parseHighScorePayload('{"other":1}')).toBe(0)
  })
})

describe('gameIpc', () => {
  it('registers prefixed handlers', async () => {
    const { ipc, handlers } = createFakeIpc()
    await gameIpc(ipc)
    expect([...handlers.keys()]).toEqual(['game:get-high-score', 'game:submit-score'])
  })

  it('returns 0 when no high score is stored yet', async () => {
    const game = await load()
    expect(await game.getHighScore()).toBe(0)
  })

  it('persists a new record and emits high-score-beaten', async () => {
    const game = await load()
    expect(await game.submitScore(500)).toBe(true)
    expect(game.sender.send).toHaveBeenCalledWith('high-score-beaten', 500)
    expect(await game.getHighScore()).toBe(500)
  })

  it('rejects a score that does not beat the record and emits nothing', async () => {
    const game = await load()
    await game.submitScore(500)
    game.sender.send.mockClear()

    expect(await game.submitScore(300)).toBe(false)
    expect(await game.submitScore(500)).toBe(false) // ties do not count
    expect(game.sender.send).not.toHaveBeenCalled()
    expect(await game.getHighScore()).toBe(500)
  })

  it('rejects invalid scores without writing or emitting', async () => {
    const game = await load()
    await game.submitScore(100)
    game.sender.send.mockClear()

    const bad = [-1, 1.25, Number.NaN, Number.POSITIVE_INFINITY, '900', null, undefined, {}]
    const results = await Promise.all(bad.map((score) => game.submitScore(score)))
    expect(results.every((ok) => ok === false)).toBe(true)
    expect(game.sender.send).not.toHaveBeenCalled()
    expect(await game.getHighScore()).toBe(100)
  })

  it('ignores malformed persisted data when reading', async () => {
    store.set('/userdata/high-score.json', '{"highScore":"boom"}')
    const game = await load()
    expect(await game.getHighScore()).toBe(0)
  })

  it('does not emit when a write fails after a would-be record', async () => {
    const game = await load()
    await game.submitScore(10)
    game.sender.send.mockClear()

    writeImpl.fn = async () => {
      throw new Error('EACCES')
    }

    await expect(game.submitScore(999)).rejects.toThrow('EACCES')
    expect(game.sender.send).not.toHaveBeenCalled()
    writeImpl.fn = null
    expect(await game.getHighScore()).toBe(10)
  })
})
