import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Upper bound accepted from the client — finite, integral, non-negative. */
export const MAX_SCORE = Number.MAX_SAFE_INTEGER

export function isValidScore(value) {
  return (
    typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= MAX_SCORE
  )
}

export function parseHighScorePayload(raw) {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 0
    return isValidScore(data.highScore) ? data.highScore : 0
  } catch {
    return 0
  }
}

/**
 * File-backed high-score store for the web target, the browser-facing twin
 * of `main/ipc/game.ipc.ts`'s Electron version: same validation, same
 * `{ highScore }` JSON shape, same write-serialization so concurrent
 * submits can't race on the file. Takes an explicit path (rather than
 * Electron's `app.getPath('userData')`) so it's trivial to point at a temp
 * file in tests.
 */
export function createHighScoreStore(filePath) {
  let writeChain = Promise.resolve()

  const enqueueWrite = (task) => {
    const run = writeChain.then(task, task)
    writeChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  const read = async () => {
    try {
      return parseHighScorePayload(await readFile(filePath, 'utf-8'))
    } catch {
      return 0
    }
  }

  const write = async (score) => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ highScore: score }), 'utf-8')
  }

  const submit = (score) => {
    if (!isValidScore(score)) return read().then((highScore) => ({ beaten: false, highScore }))

    return enqueueWrite(async () => {
      const best = await read()
      if (score <= best) return { beaten: false, highScore: best }

      await write(score)
      return { beaten: true, highScore: score }
    })
  }

  return { read, submit }
}
