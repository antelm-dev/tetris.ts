import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

const scoreFile = () => join(app.getPath('userData'), 'high-score.json')

function readHighScore(): number {
  try {
    return (JSON.parse(readFileSync(scoreFile(), 'utf-8')) as { highScore?: number }).highScore ?? 0
  } catch {
    return 0
  }
}

function writeHighScore(score: number): void {
  writeFileSync(scoreFile(), JSON.stringify({ highScore: score }), 'utf-8')
}

/**
 * Game persistence + events. Exposed to the renderer as `bridge.game.*`
 * (`getHighScore`, `submitScore`, `onHighScoreBeaten`, `onceHighScoreBeaten`).
 */
export const gameIpc = defineIpcModule('game', {
  'get-high-score': handle(async () => readHighScore()),
  'submit-score': handle(async (event, score: number) => {
    const best = readHighScore()
    if (score <= best) return false

    writeHighScore(score)
    event.sender.send('high-score-beaten', score)
    return true
  })
})
