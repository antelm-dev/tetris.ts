import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { createIpcHelpers, defineIpcModule } from 'electron-ipc-module'

/**
 * Events this module emits to the renderer. Declaring them on
 * `createIpcHelpers<TEmit>()` does two things:
 *   1. types `event.sender.send(...)` inside the handlers below, and
 *   2. tells the Rollup bridge plugin to generate typed `onRecordBeaten` /
 *      `onceRecordBeaten` subscriptions on `bridge.game`.
 */
type GameEvents = {
  'record-beaten': [payload: { mode: ModeId; records: RecordsState }]
}

const { handle } = createIpcHelpers<GameEvents>()

export type ModeId = 'endless' | 'marathon' | 'sprint' | 'ultra'

export interface EndlessRecord {
  score: number
}
export interface MarathonRecord {
  score: number
  elapsedMs: number
}
export interface SprintRecord {
  timeMs: number
}
export interface UltraRecord {
  score: number
}

export interface RecordsState {
  endless: EndlessRecord | null
  marathon: MarathonRecord | null
  sprint: SprintRecord | null
  ultra: UltraRecord | null
}

export type SubmitPayload =
  | { mode: 'endless'; score: number }
  | { mode: 'marathon'; score: number; elapsedMs: number }
  | { mode: 'sprint'; timeMs: number }
  | { mode: 'ultra'; score: number }

export interface SubmitResult {
  beaten: boolean
  records: RecordsState
}

const RECORDS_VERSION = 2
const MODE_IDS: ReadonlySet<ModeId> = new Set<ModeId>(['endless', 'marathon', 'sprint', 'ultra'])

/** Upper bound accepted from the renderer for a score or a duration (ms) — finite, integral, non-negative. */
export const MAX_VALUE = Number.MAX_SAFE_INTEGER

export const EMPTY_RECORDS: RecordsState = { endless: null, marathon: null, sprint: null, ultra: null }

const recordsFile = () => join(app.getPath('userData'), 'high-score.json')

function isNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= MAX_VALUE
  )
}

export function isValidScore(value: unknown): value is number {
  return isNonNegativeInt(value)
}

export function isValidDuration(value: unknown): value is number {
  return isNonNegativeInt(value)
}

function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && MODE_IDS.has(value as ModeId)
}

export function isValidSubmitPayload(value: unknown): value is SubmitPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  if (!isModeId(p.mode)) return false
  if (p.mode === 'sprint') return isValidDuration(p.timeMs)
  if (p.mode === 'marathon') return isValidScore(p.score) && isValidDuration(p.elapsedMs)
  return isValidScore(p.score)
}

/** Validate a single persisted mode record; malformed input is rejected rather than partially trusted. */
function isValidStoredRecord(mode: ModeId, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (mode === 'sprint') return isValidDuration(record.timeMs)
  if (mode === 'marathon') return isValidScore(record.score) && isValidDuration(record.elapsedMs)
  return isValidScore(record.score)
}

/** Validate a whole persisted records object field by field — one corrupt mode drops to `null` rather than poisoning the rest. */
function sanitizeRecords(value: unknown): RecordsState {
  const out: RecordsState = { ...EMPTY_RECORDS }
  if (!value || typeof value !== 'object') return out
  const record = value as Record<string, unknown>
  for (const mode of MODE_IDS) {
    const candidate = record[mode]
    if (candidate !== null && candidate !== undefined && isValidStoredRecord(mode, candidate)) {
      out[mode] = candidate as never
    }
  }
  return out
}

/**
 * Parse the on-disk JSON, transparently migrating the legacy `{ highScore }`
 * shape into the Endless record. Any corruption — bad JSON, wrong shape,
 * poisoned fields — fails safe to an empty record set rather than throwing.
 */
export function parseRecordsPayload(raw: string): RecordsState {
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...EMPTY_RECORDS }

    const legacyScore = (data as { highScore?: unknown }).highScore
    if (legacyScore !== undefined) {
      return { ...EMPTY_RECORDS, endless: isValidScore(legacyScore) ? { score: legacyScore } : null }
    }

    return sanitizeRecords((data as { records?: unknown }).records)
  } catch {
    return { ...EMPTY_RECORDS }
  }
}

async function readRecords(): Promise<RecordsState> {
  try {
    return parseRecordsPayload(await readFile(recordsFile(), 'utf-8'))
  } catch {
    return { ...EMPTY_RECORDS }
  }
}

async function writeRecords(records: RecordsState): Promise<void> {
  await writeFile(recordsFile(), JSON.stringify({ version: RECORDS_VERSION, records }), 'utf-8')
}

/** True if `next` beats the current record for its mode. Lower time wins for Sprint, higher score everywhere else; ties never replace. */
function beats(prev: RecordsState[ModeId] | null, next: SubmitPayload): boolean {
  if (!prev) return true
  if (next.mode === 'sprint') return (prev as SprintRecord).timeMs > next.timeMs
  return (prev as { score: number }).score < next.score
}

function recordOf(payload: SubmitPayload): RecordsState[ModeId] {
  if (payload.mode === 'sprint') return { timeMs: payload.timeMs }
  if (payload.mode === 'marathon') return { score: payload.score, elapsedMs: payload.elapsedMs }
  return { score: payload.score }
}

/** Serialize record mutations so concurrent submits cannot race on the same file. */
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
 * Per-mode Solo record persistence + events. Exposed to the renderer as
 * `bridge.game.*` (`getRecords`, `submitRecord`, `onRecordBeaten`,
 * `onceRecordBeaten`).
 */
export const gameIpc = defineIpcModule('game', {
  'get-records': handle(async (): Promise<RecordsState> => readRecords()),
  'submit-record': handle(async (event, payload: unknown): Promise<SubmitResult> => {
    if (!isValidSubmitPayload(payload)) return { beaten: false, records: { ...EMPTY_RECORDS } }

    return enqueueWrite(async (): Promise<SubmitResult> => {
      const records = await readRecords()
      if (!beats(records[payload.mode], payload)) return { beaten: false, records }

      const updated: RecordsState = { ...records, [payload.mode]: recordOf(payload) }
      await writeRecords(updated)
      event.sender.send('record-beaten', { mode: payload.mode, records: updated })
      return { beaten: true, records: updated }
    })
  })
})
