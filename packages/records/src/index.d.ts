/** Type surface for the shared high-score records contract (@tetris/records). */

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

export interface HighScoreStore {
  read(): Promise<RecordsState>
  submit(payload: unknown): Promise<SubmitResult>
}

/** Upper bound accepted from a client for a score or a duration (ms). */
export declare const MAX_VALUE: number
export declare const EMPTY_RECORDS: RecordsState

export declare function isValidScore(value: unknown): value is number
export declare function isValidDuration(value: unknown): value is number
export declare function isValidSubmitPayload(value: unknown): value is SubmitPayload
export declare function parseRecordsPayload(raw: string): RecordsState

/** File-backed, write-serialized per-mode records store. */
export declare function createHighScoreStore(filePath: string): HighScoreStore
