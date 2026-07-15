import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The fake `readFile`/`writeFile` below key their in-memory store by whatever
// path string the code under test computes — which goes through `node:path`'s
// platform-specific `join`, not a literal POSIX path. Compute the same key
// here rather than hardcoding a forward-slash string that only matches on
// POSIX.
const RECORDS_PATH = join('/userdata', 'high-score.json')

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

import {
  EMPTY_RECORDS,
  gameIpc,
  isValidDuration,
  isValidScore,
  isValidSubmitPayload,
  parseRecordsPayload,
  type RecordsState,
  type SubmitPayload,
  type SubmitResult
} from '../../main/ipc/game.ipc'
import { createFakeIpc } from './fake-ipc'

const load = async () => {
  const { ipc, handlers } = createFakeIpc()
  await gameIpc(ipc)
  const sender = { send: vi.fn() }
  const event = { sender } as never
  return {
    sender,
    getRecords: () => handlers.get('game:get-records')!(event) as Promise<RecordsState>,
    submitRecord: (payload: unknown) => handlers.get('game:submit-record')!(event, payload) as Promise<SubmitResult>
  }
}

beforeEach(() => {
  store.clear()
  writeImpl.fn = null
})

describe('validation', () => {
  it('accepts finite non-negative integers only, for both scores and durations', () => {
    for (const isValid of [isValidScore, isValidDuration]) {
      expect(isValid(0)).toBe(true)
      expect(isValid(42)).toBe(true)
      expect(isValid(-1)).toBe(false)
      expect(isValid(1.5)).toBe(false)
      expect(isValid(Number.POSITIVE_INFINITY)).toBe(false)
      expect(isValid(Number.NaN)).toBe(false)
      expect(isValid('10')).toBe(false)
      expect(isValid(null)).toBe(false)
    }
  })

  it('validates a submission payload per mode', () => {
    expect(isValidSubmitPayload({ mode: 'endless', score: 100 })).toBe(true)
    expect(isValidSubmitPayload({ mode: 'marathon', score: 100, elapsedMs: 500 })).toBe(true)
    expect(isValidSubmitPayload({ mode: 'sprint', timeMs: 500 })).toBe(true)
    expect(isValidSubmitPayload({ mode: 'ultra', score: 100 })).toBe(true)

    expect(isValidSubmitPayload({ mode: 'marathon', score: 100 })).toBe(false) // missing elapsedMs
    expect(isValidSubmitPayload({ mode: 'sprint', score: 100 })).toBe(false) // wrong field for the mode
    expect(isValidSubmitPayload({ mode: 'not-a-mode', score: 100 })).toBe(false)
    expect(isValidSubmitPayload({ mode: 'endless', score: -1 })).toBe(false)
    expect(isValidSubmitPayload(null)).toBe(false)
    expect(isValidSubmitPayload('endless')).toBe(false)
  })

  it('parses a v2 records payload, dropping corrupt individual modes', () => {
    const raw = JSON.stringify({
      version: 2,
      records: {
        endless: { score: 900 },
        marathon: { score: 'nope', elapsedMs: 500 }, // corrupt — dropped
        sprint: { timeMs: 1234 },
        ultra: null
      }
    })
    expect(parseRecordsPayload(raw)).toEqual({
      endless: { score: 900 },
      marathon: null,
      sprint: { timeMs: 1234 },
      ultra: null
    })
  })

  it('fails safe on corrupt or malformed JSON', () => {
    expect(parseRecordsPayload('not-json')).toEqual(EMPTY_RECORDS)
    expect(parseRecordsPayload('[]')).toEqual(EMPTY_RECORDS)
    expect(parseRecordsPayload('"string"')).toEqual(EMPTY_RECORDS)
    expect(parseRecordsPayload('{"records":"not-an-object"}')).toEqual(EMPTY_RECORDS)
  })

  it('migrates the legacy { highScore } shape into the Endless record', () => {
    expect(parseRecordsPayload('{"highScore":93115}')).toEqual({ ...EMPTY_RECORDS, endless: { score: 93115 } })
    // A corrupt legacy value still fails safe rather than poisoning the migration.
    expect(parseRecordsPayload('{"highScore":"boom"}')).toEqual(EMPTY_RECORDS)
  })
})

describe('gameIpc', () => {
  it('registers prefixed handlers', async () => {
    const { ipc, handlers } = createFakeIpc()
    await gameIpc(ipc)
    expect([...handlers.keys()]).toEqual(['game:get-records', 'game:submit-record'])
  })

  it('returns empty records when nothing is stored yet', async () => {
    const game = await load()
    expect(await game.getRecords()).toEqual(EMPTY_RECORDS)
  })

  it('persists a new per-mode record and emits record-beaten', async () => {
    const game = await load()
    const payload: SubmitPayload = { mode: 'endless', score: 500 }
    const result = await game.submitRecord(payload)
    expect(result).toEqual({ beaten: true, records: { ...EMPTY_RECORDS, endless: { score: 500 } } })
    expect(game.sender.send).toHaveBeenCalledWith('record-beaten', {
      mode: 'endless',
      records: { ...EMPTY_RECORDS, endless: { score: 500 } }
    })
    expect(await game.getRecords()).toEqual({ ...EMPTY_RECORDS, endless: { score: 500 } })
  })

  it('rejects a score that does not beat the record and emits nothing (ties do not count)', async () => {
    const game = await load()
    await game.submitRecord({ mode: 'endless', score: 500 })
    game.sender.send.mockClear()

    expect(await game.submitRecord({ mode: 'endless', score: 300 })).toEqual({
      beaten: false,
      records: { ...EMPTY_RECORDS, endless: { score: 500 } }
    })
    expect(await game.submitRecord({ mode: 'endless', score: 500 })).toMatchObject({ beaten: false })
    expect(game.sender.send).not.toHaveBeenCalled()
  })

  it('ranks Sprint by lowest time — a higher time does not beat the record, ties do not count', async () => {
    const game = await load()
    await game.submitRecord({ mode: 'sprint', timeMs: 30_000 })
    game.sender.send.mockClear()

    expect(await game.submitRecord({ mode: 'sprint', timeMs: 45_000 })).toMatchObject({ beaten: false })
    expect(await game.submitRecord({ mode: 'sprint', timeMs: 30_000 })).toMatchObject({ beaten: false })
    expect(await game.submitRecord({ mode: 'sprint', timeMs: 20_000 })).toEqual({
      beaten: true,
      records: { ...EMPTY_RECORDS, sprint: { timeMs: 20_000 } }
    })
  })

  it('stores Marathon elapsedMs as supporting data, still ranked by score', async () => {
    const game = await load()
    await game.submitRecord({ mode: 'marathon', score: 1000, elapsedMs: 90_000 })
    // A faster but lower-scoring run does not beat the record.
    expect(await game.submitRecord({ mode: 'marathon', score: 500, elapsedMs: 10_000 })).toMatchObject({
      beaten: false
    })
    expect(await game.getRecords()).toMatchObject({ marathon: { score: 1000, elapsedMs: 90_000 } })
  })

  it('keeps every mode independent', async () => {
    const game = await load()
    await game.submitRecord({ mode: 'endless', score: 100 })
    await game.submitRecord({ mode: 'ultra', score: 200 })
    expect(await game.getRecords()).toEqual({
      endless: { score: 100 },
      marathon: null,
      sprint: null,
      ultra: { score: 200 }
    })
  })

  it('rejects invalid payloads without writing or emitting', async () => {
    const game = await load()
    await game.submitRecord({ mode: 'endless', score: 100 })
    game.sender.send.mockClear()

    const bad: unknown[] = [
      { mode: 'endless', score: -1 },
      { mode: 'marathon', score: 100 }, // missing elapsedMs
      { mode: 'sprint', timeMs: 'fast' },
      { mode: 'not-a-mode', score: 100 },
      null,
      undefined,
      {}
    ]
    const results = await Promise.all(bad.map((payload) => game.submitRecord(payload)))
    expect(results.every((r) => r.beaten === false)).toBe(true)
    expect(game.sender.send).not.toHaveBeenCalled()
    expect(await game.getRecords()).toEqual({ ...EMPTY_RECORDS, endless: { score: 100 } })
  })

  it('ignores malformed persisted data when reading', async () => {
    store.set(RECORDS_PATH, '{"records":{"endless":"boom"}}')
    const game = await load()
    expect(await game.getRecords()).toEqual(EMPTY_RECORDS)
  })

  it('migrates legacy on-disk data transparently', async () => {
    store.set(RECORDS_PATH, '{"highScore":777}')
    const game = await load()
    expect(await game.getRecords()).toEqual({ ...EMPTY_RECORDS, endless: { score: 777 } })
  })

  it('does not emit when a write fails after a would-be record', async () => {
    const game = await load()
    await game.submitRecord({ mode: 'endless', score: 10 })
    game.sender.send.mockClear()

    writeImpl.fn = async () => {
      throw new Error('EACCES')
    }

    await expect(game.submitRecord({ mode: 'endless', score: 999 })).rejects.toThrow('EACCES')
    expect(game.sender.send).not.toHaveBeenCalled()
    writeImpl.fn = null
    expect(await game.getRecords()).toEqual({ ...EMPTY_RECORDS, endless: { score: 10 } })
  })

  it('serializes concurrent submits so each is judged against the previous write, not a stale read', async () => {
    const game = await load()
    // Calls (and therefore the write-chain order) happen synchronously in
    // this order: 100 beats 0, 300 beats 100, 200 does not beat 300.
    const results = await Promise.all([
      game.submitRecord({ mode: 'endless', score: 100 }),
      game.submitRecord({ mode: 'endless', score: 300 }),
      game.submitRecord({ mode: 'endless', score: 200 })
    ])
    expect(results.map((r) => r.beaten)).toEqual([true, true, false])
    expect(await game.getRecords()).toEqual({ ...EMPTY_RECORDS, endless: { score: 300 } })
  })
})
