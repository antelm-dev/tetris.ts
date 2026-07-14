import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { createIpcHelpers, defineIpcModule } from 'electron-ipc-module'

/**
 * Events this module emits to the renderer. Declaring them on
 * `createIpcHelpers<TEmit>()` does two things:
 *   1. types `event.sender.send(...)` inside the handlers below, and
 *   2. tells the Rollup bridge plugin to generate typed `onHighScoreBeaten` /
 *      `onceHighScoreBeaten` subscriptions on `bridge.game`.
 */
type GameEvents = {
  'high-score-beaten': [score: number]
}

const { handle } = createIpcHelpers<GameEvents>()

/** Upper bound accepted from the renderer — finite, integral, non-negative. */
export const MAX_SCORE = Number.MAX_SAFE_INTEGER

const scoreFile = () => join(app.getPath('userData'), 'high-score.json')

export function isValidScore(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= MAX_SCORE
  )
}

export function parseHighScorePayload(raw: string): number {
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 0
    const score = (data as { highScore?: unknown }).highScore
    return isValidScore(score) ? score : 0
  } catch {
    return 0
  }
}

async function readHighScore(): Promise<number> {
  try {
    return parseHighScorePayload(await readFile(scoreFile(), 'utf-8'))
  } catch {
    return 0
  }
}

async function writeHighScore(score: number): Promise<void> {
  await writeFile(scoreFile(), JSON.stringify({ highScore: score }), 'utf-8')
}

/** Serialize score mutations so concurrent submits cannot race on the same file. */
let writeChain: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * Game persistence + events. Exposed to the renderer as `bridge.game.*`
 * (`getHighScore`, `submitScore`, `onHighScoreBeaten`, `onceHighScoreBeaten`).
 */
export const gameIpc = defineIpcModule('game', {
  'get-high-score': handle(async () => readHighScore()),
  'submit-score': handle(async (event, score: unknown) => {
    if (!isValidScore(score)) return false

    return enqueueWrite(async () => {
      const best = await readHighScore()
      if (score <= best) return false

      await writeHighScore(score)
      event.sender.send('high-score-beaten', score)
      return true
    })
  })
})
