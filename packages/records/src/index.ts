import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ModeId = 'endless' | 'marathon' | 'sprint' | 'ultra'

export type EndlessRecord = { score: number }
export type MarathonRecord = { score: number; elapsedMs: number }
export type SprintRecord = { timeMs: number }
export type UltraRecord = { score: number }

export type RecordsState = {
  [M in ModeId]: ModeRecord[M] | null
}

type ModeRecord = {
  endless: EndlessRecord
  marathon: MarathonRecord
  sprint: SprintRecord
  ultra: UltraRecord
}

export type SubmitPayload =
  | { mode: 'endless'; score: number }
  | { mode: 'marathon'; score: number; elapsedMs: number }
  | { mode: 'sprint'; timeMs: number }
  | { mode: 'ultra'; score: number }

export type SubmitResult = {
  beaten: boolean
  records: RecordsState
}

export type HighScoreStore = {
  read(): Promise<RecordsState>
  submit(payload: unknown): Promise<SubmitResult>
}

export const MAX_VALUE = Number.MAX_SAFE_INTEGER

const MODE_IDS = new Set<ModeId>(['endless', 'marathon', 'sprint', 'ultra'])
const RECORDS_VERSION = 2

export const EMPTY_RECORDS: RecordsState = {
  endless: null,
  marathon: null,
  sprint: null,
  ultra: null
}

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
  const payload = value as Record<string, unknown>
  if (!isModeId(payload.mode)) return false
  if (payload.mode === 'sprint') return isValidDuration(payload.timeMs)
  if (payload.mode === 'marathon') return isValidScore(payload.score) && isValidDuration(payload.elapsedMs)
  return isValidScore(payload.score)
}

function isValidStoredRecord<M extends ModeId>(mode: M, value: unknown): value is ModeRecord[M] {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (mode === 'sprint') return isValidDuration(record.timeMs)
  if (mode === 'marathon') return isValidScore(record.score) && isValidDuration(record.elapsedMs)
  return isValidScore(record.score)
}

function setRecord<M extends ModeId>(out: RecordsState, mode: M, record: ModeRecord[M]) {
  out[mode] = record
}

function sanitizeRecords(value: unknown): RecordsState {
  const out: RecordsState = { ...EMPTY_RECORDS }
  if (!value || typeof value !== 'object') return out
  const source = value as Partial<Record<ModeId, unknown>>
  for (const mode of MODE_IDS) {
    const candidate = source[mode]
    if (candidate != null && isValidStoredRecord(mode, candidate)) setRecord(out, mode, candidate)
  }
  return out
}

export function parseRecordsPayload(raw: string): RecordsState {
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...EMPTY_RECORDS }

    const payload = data as Record<string, unknown>
    if (payload.highScore !== undefined) {
      return { ...EMPTY_RECORDS, endless: isValidScore(payload.highScore) ? { score: payload.highScore } : null }
    }

    return sanitizeRecords(payload.records)
  } catch {
    return { ...EMPTY_RECORDS }
  }
}

function beats(prev: RecordsState[ModeId], next: SubmitPayload): boolean {
  if (!prev) return true
  if (next.mode === 'sprint') return 'timeMs' in prev && prev.timeMs > next.timeMs
  return 'score' in prev && prev.score < next.score
}

function recordOf(payload: SubmitPayload): ModeRecord[ModeId] {
  if (payload.mode === 'sprint') return { timeMs: payload.timeMs }
  if (payload.mode === 'marathon') return { score: payload.score, elapsedMs: payload.elapsedMs }
  return { score: payload.score }
}

export function createHighScoreStore(filePath: string): HighScoreStore {
  let writeChain = Promise.resolve()

  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
    const run = writeChain.then(task, task)
    writeChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  const read = async (): Promise<RecordsState> => {
    try {
      return parseRecordsPayload(await readFile(filePath, 'utf-8'))
    } catch {
      return { ...EMPTY_RECORDS }
    }
  }

  const write = async (records: RecordsState): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ version: RECORDS_VERSION, records }), 'utf-8')
  }

  const submit = (payload: unknown): Promise<SubmitResult> => {
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
