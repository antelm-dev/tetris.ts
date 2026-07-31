import { createIpcHelpers, defineIpcModule } from 'electron-ipc-module'
import { updater, type UpdateState } from '../core/updater.js'

/**
 * Emitted on every transition of the update state machine. Declaring it here
 * makes the bridge plugin generate `bridge.update.onUpdateStateChanged`.
 */
type UpdateEvents = {
  'update-state-changed': [state: UpdateState]
}

const { handle, listen } = createIpcHelpers<UpdateEvents>()

/**
 * Auto-update controls for the titlebar widget. Exposed to the renderer as
 * `bridge.update.*`; the state machine itself lives in `core/updater.ts`.
 */
export const updateIpc = defineIpcModule('update', {
  state: handle(async () => updater.current()),
  check: handle(async () => updater.check()),
  // Fire-and-forget: the renderer reacts to `update-state-changed`, not to a
  // return value — and installing never returns, it quits the app.
  advance: listen(() => void updater.advance())
})
