import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHighScoreStore, isValidScore, parseHighScorePayload } from '../../server/high-scores.mjs'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tetris-high-score-'))
  filePath = join(dir, 'high-score.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
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

describe('createHighScoreStore', () => {
  it('returns 0 when no high score is stored yet', async () => {
    const store = createHighScoreStore(filePath)
    expect(await store.read()).toBe(0)
  })

  it('persists a new record and reports it beaten', async () => {
    const store = createHighScoreStore(filePath)
    expect(await store.submit(500)).toEqual({ beaten: true, highScore: 500 })
    expect(await store.read()).toBe(500)
  })

  it('rejects a score that does not beat the record', async () => {
    const store = createHighScoreStore(filePath)
    await store.submit(500)

    expect(await store.submit(300)).toEqual({ beaten: false, highScore: 500 })
    expect(await store.submit(500)).toEqual({ beaten: false, highScore: 500 }) // ties do not count
    expect(await store.read()).toBe(500)
  })

  it('rejects invalid scores without writing', async () => {
    const store = createHighScoreStore(filePath)
    await store.submit(100)

    const bad = [-1, 1.25, Number.NaN, Number.POSITIVE_INFINITY, '900', null, undefined, {}]
    const results = await Promise.all(bad.map((score) => store.submit(score)))
    expect(results.every((r) => r.beaten === false)).toBe(true)
    expect(await store.read()).toBe(100)
  })

  it('ignores malformed persisted data when reading', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, '{"highScore":"boom"}', 'utf-8')

    const store = createHighScoreStore(filePath)
    expect(await store.read()).toBe(0)
  })

  it('serializes concurrent submits so each is judged against the previous write, not a stale read', async () => {
    const store = createHighScoreStore(filePath)
    // Calls (and therefore the write-chain order) happen synchronously in
    // this order: 100 beats 0, 300 beats 100, 200 does not beat 300.
    const results = await Promise.all([store.submit(100), store.submit(300), store.submit(200)])

    expect(results.map((r) => r.beaten)).toEqual([true, true, false])
    expect(await store.read()).toBe(300)
  })
})
