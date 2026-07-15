import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHighScoreStore,
  EMPTY_RECORDS,
  isValidDuration,
  isValidScore,
  isValidSubmitPayload,
  parseRecordsPayload
} from '../../server/high-scores.mjs'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tetris-high-score-'))
  filePath = join(dir, 'high-score.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
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

    expect(isValidSubmitPayload({ mode: 'marathon', score: 100 })).toBe(false)
    expect(isValidSubmitPayload({ mode: 'sprint', score: 100 })).toBe(false)
    expect(isValidSubmitPayload({ mode: 'not-a-mode', score: 100 })).toBe(false)
    expect(isValidSubmitPayload(null)).toBe(false)
  })

  it('parses a v2 records payload, dropping corrupt individual modes', () => {
    const raw = JSON.stringify({
      version: 2,
      records: {
        endless: { score: 900 },
        marathon: { score: 'nope', elapsedMs: 500 },
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
    expect(parseRecordsPayload('{"records":"not-an-object"}')).toEqual(EMPTY_RECORDS)
  })

  it('migrates the legacy { highScore } shape into the Endless record', () => {
    expect(parseRecordsPayload('{"highScore":93115}')).toEqual({ ...EMPTY_RECORDS, endless: { score: 93115 } })
    expect(parseRecordsPayload('{"highScore":"boom"}')).toEqual(EMPTY_RECORDS)
  })
})

describe('createHighScoreStore', () => {
  it('returns empty records when nothing is stored yet', async () => {
    const store = createHighScoreStore(filePath)
    expect(await store.read()).toEqual(EMPTY_RECORDS)
  })

  it('persists a new per-mode record and reports it beaten', async () => {
    const store = createHighScoreStore(filePath)
    expect(await store.submit({ mode: 'endless', score: 500 })).toEqual({
      beaten: true,
      records: { ...EMPTY_RECORDS, endless: { score: 500 } }
    })
    expect(await store.read()).toEqual({ ...EMPTY_RECORDS, endless: { score: 500 } })
  })

  it('rejects a score that does not beat the record (ties do not count)', async () => {
    const store = createHighScoreStore(filePath)
    await store.submit({ mode: 'endless', score: 500 })

    expect(await store.submit({ mode: 'endless', score: 300 })).toMatchObject({ beaten: false })
    expect(await store.submit({ mode: 'endless', score: 500 })).toMatchObject({ beaten: false })
    expect(await store.read()).toEqual({ ...EMPTY_RECORDS, endless: { score: 500 } })
  })

  it('ranks Sprint by lowest time — ties do not count', async () => {
    const store = createHighScoreStore(filePath)
    await store.submit({ mode: 'sprint', timeMs: 30_000 })

    expect(await store.submit({ mode: 'sprint', timeMs: 45_000 })).toMatchObject({ beaten: false })
    expect(await store.submit({ mode: 'sprint', timeMs: 30_000 })).toMatchObject({ beaten: false })
    expect(await store.submit({ mode: 'sprint', timeMs: 20_000 })).toEqual({
      beaten: true,
      records: { ...EMPTY_RECORDS, sprint: { timeMs: 20_000 } }
    })
  })

  it('keeps every mode independent', async () => {
    const store = createHighScoreStore(filePath)
    await store.submit({ mode: 'endless', score: 100 })
    await store.submit({ mode: 'ultra', score: 200 })
    expect(await store.read()).toEqual({ endless: { score: 100 }, marathon: null, sprint: null, ultra: { score: 200 } })
  })

  it('rejects invalid payloads without writing', async () => {
    const store = createHighScoreStore(filePath)
    await store.submit({ mode: 'endless', score: 100 })

    const bad: unknown[] = [
      { mode: 'endless', score: -1 },
      { mode: 'marathon', score: 100 },
      { mode: 'sprint', timeMs: 'fast' },
      { mode: 'not-a-mode', score: 100 },
      null,
      undefined,
      {}
    ]
    const results = await Promise.all(bad.map((payload) => store.submit(payload)))
    expect(results.every((r) => r.beaten === false)).toBe(true)
    expect(await store.read()).toEqual({ ...EMPTY_RECORDS, endless: { score: 100 } })
  })

  it('ignores malformed persisted data when reading', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, '{"records":{"endless":"boom"}}', 'utf-8')

    const store = createHighScoreStore(filePath)
    expect(await store.read()).toEqual(EMPTY_RECORDS)
  })

  it('migrates legacy on-disk data transparently', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, '{"highScore":777}', 'utf-8')

    const store = createHighScoreStore(filePath)
    expect(await store.read()).toEqual({ ...EMPTY_RECORDS, endless: { score: 777 } })
  })

  it('serializes concurrent submits so each is judged against the previous write, not a stale read', async () => {
    const store = createHighScoreStore(filePath)
    const results = await Promise.all([
      store.submit({ mode: 'endless', score: 100 }),
      store.submit({ mode: 'endless', score: 300 }),
      store.submit({ mode: 'endless', score: 200 })
    ])

    expect(results.map((r) => r.beaten)).toEqual([true, true, false])
    expect(await store.read()).toEqual({ ...EMPTY_RECORDS, endless: { score: 300 } })
  })
})
