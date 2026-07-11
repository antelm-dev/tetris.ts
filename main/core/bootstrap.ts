import { app, BrowserWindow, dialog, protocol } from 'electron'
import type { createCustomScheme } from './electron.js'

type MaybePromise<T> = T | Promise<T>
type Protocol = ReturnType<typeof createCustomScheme>

export type PrepareOptions = {
  protocols?: {
    scheme: Protocol
    handler: (request: Request) => Response | Promise<Response>
  }[]
  createWindow?: () => MaybePromise<BrowserWindow>
  onReady?: () => MaybePromise<void>
  onBeforeQuit?: (e: { preventDefault: () => void; defaultPrevented: boolean }) => MaybePromise<void>
  url?: string
}

/**
 * Wire up the Electron app lifecycle: register privileged schemes, create the
 * main window once ready, attach protocol handlers, and tear everything down
 * cleanly on quit. Extracted from the desktop app's core, minus React Router.
 */
export function prepare(options: PrepareOptions = {}) {
  const { url, protocols = [], createWindow = () => new BrowserWindow(), onBeforeQuit, onReady } = options

  protocol.registerSchemesAsPrivileged(protocols.map(({ scheme }) => scheme.scheme))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('ready', async () => {
    try {
      await onReady?.()
      protocols.forEach(({ scheme, handler }) => scheme.registerHandler(handler))

      const win = await createWindow()
      if (url) win.webContents.loadURL(url)

      app.once('before-quit', (e) => {
        e.preventDefault()
        void Promise.resolve()
          .then(() => onBeforeQuit?.(e))
          .catch(handleError)
          .finally(() => {
            protocols.forEach(({ scheme }) => scheme.unregisterHandler())
            app.exit(0)
          })
      })
    } catch (error) {
      handleError(error)
    }
  })
}

function handleError(error: unknown) {
  dialog.showErrorBox('Une erreur est survenue', error instanceof Error ? error.message : String(error))
  process.crash()
}
