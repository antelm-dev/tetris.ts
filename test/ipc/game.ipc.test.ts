import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const value = store.get(path)
    if (value === undefined) throw new Error('ENOENT')
    return value
  },
  writeFileSync: (path: string, data: string) => {
    store.set(path, data)
  }
}))

import { gameIpc } from '../../main/ipc/game.ipc'
import { createFakeIpc } from './fake-ipc'

const load = async () => {
  const { ipc, handlers } = createFakeIpc()
  await gameIpc(ipc)
  const sender = { send: vi.fn() }
  const event = { sender } as never
  return {
    sender,
    getHighScore: () => handlers.get('game:get-high-score')!(event) as Promise<number>,
    submitScore: (score: number) => handlers.get('game:submit-score')!(event, score) as Promise<boolean>
  }
}

beforeEach(() => store.clear())

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
})
