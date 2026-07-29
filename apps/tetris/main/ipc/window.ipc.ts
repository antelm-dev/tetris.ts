import { BrowserWindow } from 'electron'
import { createIpcHelpers, defineIpcModule } from 'electron-ipc-module'

/**
 * Events this module emits to the renderer. Declaring them on
 * `createIpcHelpers` tells the bridge plugin to generate typed
 * `onFullscreenChanged` / `onceFullscreenChanged` subscriptions.
 */
type WindowEvents = {
  'fullscreen-changed': [fullscreen: boolean]
}

const { listen } = createIpcHelpers<WindowEvents>()

/**
 * Window controls for the custom (frameless) titlebar. These are fire-and-forget
 * `listen` channels — the renderer sends, the main process acts, nothing is
 * returned. Exposed to the renderer as `bridge.window.*`.
 *
 * Fullscreen enter/leave is emitted from the BrowserWindow itself (see
 * {@link wireFullscreenEvents}) so the signal covers the titlebar button and
 * any OS-level toggle.
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

/** Forward OS fullscreen transitions to the renderer so it can hide the titlebar. */
export function wireFullscreenEvents(win: BrowserWindow): void {
  win.on('enter-full-screen', () => {
    win.webContents.send('fullscreen-changed', true)
  })
  win.on('leave-full-screen', () => {
    win.webContents.send('fullscreen-changed', false)
  })
}
