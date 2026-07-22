import { contextBridge } from 'electron'
import { bridge } from './generated/ipc-bridge.js'

/** The API surface exposed to the renderer via `window.electron`. */
const api = { bridge }

export type ElectronApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).electron = api
}
