import { join } from 'node:path'
import { app } from 'electron'
import { createIpcHelpers, defineIpcModule } from 'electron-ipc-module'
import { createHighScoreStore } from '@tetris/records'
import type { ModeId, RecordsState, SubmitPayload, SubmitResult } from '@tetris/records'

/**
 * Per-mode Solo record persistence + events. The schema, validation and
 * file-backed store live in the shared `@tetris/records` package — the same
 * source of truth the web server uses (`apps/tetris/server/index.mjs`). This
 * module is only the Electron shell around it: it picks the on-disk path from
 * `app.getPath('userData')`, exposes the store over IPC as `bridge.game.*`
 * (`getRecords`, `submitRecord`, `onRecordBeaten`, `onceRecordBeaten`), and
 * forwards a `record-beaten` event to the renderer when a record falls.
 */

// Re-export the shared contract so existing importers can keep sourcing it here.
export type {
  ModeId,
  EndlessRecord,
  MarathonRecord,
  SprintRecord,
  UltraRecord,
  RecordsState,
  SubmitPayload,
  SubmitResult
} from '@tetris/records'
export {
  EMPTY_RECORDS,
  MAX_VALUE,
  isValidScore,
  isValidDuration,
  isValidSubmitPayload,
  parseRecordsPayload
} from '@tetris/records'

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

/** Lazily created so `app.getPath('userData')` is read only once Electron is ready. */
let store: ReturnType<typeof createHighScoreStore> | undefined
const recordsStore = (): ReturnType<typeof createHighScoreStore> =>
  (store ??= createHighScoreStore(join(app.getPath('userData'), 'high-score.json')))

export const gameIpc = defineIpcModule('game', {
  'get-records': handle((): Promise<RecordsState> => recordsStore().read()),
  'submit-record': handle(async (event, payload: unknown): Promise<SubmitResult> => {
    const result = await recordsStore().submit(payload)
    if (result.beaten) {
      event.sender.send('record-beaten', { mode: (payload as SubmitPayload).mode, records: result.records })
    }
    return result
  })
})
