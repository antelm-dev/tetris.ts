import { app } from 'electron'
import { defineIpcModule, handle } from 'electron-ipc-module'

/**
 * System IPC channels. Registered in the main process and exposed to the
 * renderer through the generated preload bridge as `bridge.system.*`.
 */
export const systemIpc = defineIpcModule('system', {
  ping: handle(async () => 'pong'),
  'get-version': handle(async () => app.getVersion())
})
