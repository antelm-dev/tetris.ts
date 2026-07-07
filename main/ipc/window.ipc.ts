import { BrowserWindow } from 'electron'
import { defineIpcModule, listen } from 'electron-ipc-module'

/**
 * Window controls for the custom (frameless) titlebar. These are fire-and-forget
 * `listen` channels — the renderer sends, the main process acts, nothing is
 * returned. Exposed to the renderer as `bridge.window.*`.
 */
export const windowIpc = defineIpcModule('window', {
  minimize: listen((event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  }),
  close: listen((event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  }),
  'toggle-fullscreen': listen((event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setFullScreen(!win.isFullScreen())
  })
})
