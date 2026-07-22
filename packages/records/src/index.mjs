import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * @tetris/records — the single source of truth for the per-mode high-score
 * contract shared by the two record backends: the Electron main process
 * (`apps/tetris/main/ipc/game.ipc.ts`) and the web Express server
 * (`apps/tetris/server/index.mjs`). Same versioned schema, same validation,
 * same write-serialized store — authored once here so the two can't drift.
 *
 * Authored as ESM JavaScript (with a colocated `index.d.ts`) so raw Node — the
 * web server runs under `node`, not a bundler — can import it directly, while
 * the bundled Electron side still gets full types.
 */

/** Upper bound accepted from a client for a score or a duration (ms) — finite, integral, non-negative. */
export const MAX_VALUE = Number.MAX_SAFE_INTEGER

const MODE_IDS = new Set(['endless', 'marathon', 'sprint', 'ultra'])
const RECORDS_VERSION = 2

export const EMPTY_RECORDS = { endless: null, marathon: null, sprint: null, ultra: null }

function isNonNegativeInt(value) {
  return (
    typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= MAX_VALUE
  )
}

export function isValidScore(value) {
  return isNonNegativeInt(value)
}

export function isValidDuration(value) {
  return isNonNegativeInt(value)
}

function isModeId(value) {
  return typeof value === 'string' && MODE_IDS.has(value)
}

export function isValidSubmitPayload(value) {
  if (!value || typeof value !== 'object') return false
  if (!isModeId(value.mode)) return false
  if (value.mode === 'sprint') return isValidDuration(value.timeMs)
  if (value.mode === 'marathon') return isValidScore(value.score) && isValidDuration(value.elapsedMs)
  return isValidScore(value.score)
}

function isValidStoredRecord(mode, value) {
  if (!value || typeof value !== 'object') return false
  if (mode === 'sprint') return isValidDuration(value.timeMs)
  if (mode === 'marathon') return isValidScore(value.score) && isValidDuration(value.elapsedMs)
  return isValidScore(value.score)
}

/** Validate a whole persisted records object field by field — one corrupt mode drops to `null` rather than poisoning the rest. */
function sanitizeRecords(value) {
  const out = { ...EMPTY_RECORDS }
  if (!value || typeof value !== 'object') return out
  for (const mode of MODE_IDS) {
    const candidate = value[mode]
    if (candidate !== null && candidate !== undefined && isValidStoredRecord(mode, candidate)) out[mode] = candidate
  }
  return out
}

/**
 * Parse the on-disk JSON, transparently migrating the legacy `{ highScore }`
 * shape into the Endless record. Any corruption fails safe to an empty record
 * set rather than throwing.
 */
export function parseRecordsPayload(raw) {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...EMPTY_RECORDS }

    if (data.highScore !== undefined) {
      return { ...EMPTY_RECORDS, endless: isValidScore(data.highScore) ? { score: data.highScore } : null }
    }

    return sanitizeRecords(data.records)
  } catch {
    return { ...EMPTY_RECORDS }
  }
}

/** True if `next` beats the current record for its mode. Lower time wins for Sprint, higher score everywhere else; ties never replace. */
function beats(prev, next) {
  if (!prev) return true
  if (next.mode === 'sprint') return prev.timeMs > next.timeMs
  return prev.score < next.score
}

function recordOf(payload) {
  if (payload.mode === 'sprint') return { timeMs: payload.timeMs }
  if (payload.mode === 'marathon') return { score: payload.score, elapsedMs: payload.elapsedMs }
  return { score: payload.score }
}

/**
 * File-backed per-mode records store. Takes an explicit path (rather than
 * assuming Electron's `app.getPath('userData')`) so both backends — and tests
 * pointing at a temp file — can share it. `submit` resolves `{ beaten, records }`
 * and emits no events itself, leaving the Electron side free to forward a
 * `record-beaten` event to its renderer. Writes are serialized so concurrent
 * submits can't race on the file.
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
      return parseRecordsPayload(await readFile(filePath, 'utf-8'))
    } catch {
      return { ...EMPTY_RECORDS }
    }
  }

  const write = async (records) => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ version: RECORDS_VERSION, records }), 'utf-8')
  }

  const submit = (payload) => {
    if (!isValidSubmitPayload(payload)) return Promise.resolve({ beaten: false, records: { ...EMPTY_RECORDS } })

    return enqueueWrite(async () => {
      const records = await read()
      if (!beats(records[payload.mode], payload)) return { beaten: false, records }

      const updated = { ...records, [payload.mode]: recordOf(payload) }
      await write(updated)
      return { beaten: true, records: updated }
    })
  }

  return { read, submit }
}
