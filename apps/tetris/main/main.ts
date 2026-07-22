import { BrowserWindow, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { createIpcContainer } from 'electron-ipc-module'
import { prepare } from './core/bootstrap.js'
import { createCustomScheme } from './core/electron.js'
import { isAllowedExternalUrl } from './core/external-url.js'
import { env } from './env.js'
import { gameIpc } from './ipc/game.ipc.js'
import { systemIpc } from './ipc/system.ipc.js'
import { windowIpc, wireFullscreenEvents } from './ipc/window.ipc.js'

const scheme = createCustomScheme(env.scheme, {
  standard: true,
  secure: true,
  supportFetchAPI: true
})

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg'
}

const CLIENT_DIR = resolve(env.paths.clientDir)

/**
 * Serve the built renderer (`dist-renderer`) over the `app://` scheme.
 *
 * The requested path is untrusted: anything the page loads — including a URL a
 * compromised renderer builds itself — arrives here. So it is resolved against
 * the bundle directory and any result that lands outside it (`../../`, an
 * absolute path, an encoded separator) is refused rather than read off disk.
 */
async function serveClient(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)

  let requested: string
  try {
    requested = pathname === '/' ? 'index.electron.html' : decodeURIComponent(pathname.replace(/^\/+/, ''))
  } catch {
    // Malformed percent-encoding.
    return new Response('Bad request', { status: 400 })
  }

  const file = resolve(CLIENT_DIR, requested)
  const rel = relative(CLIENT_DIR, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const data = await readFile(file)
    const type = MIME_TYPES[extname(file)] ?? 'application/octet-stream'
    return new Response(data, { headers: { 'content-type': type } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: env.window.width,
    height: env.window.height,
    icon: env.paths.icon,
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    maximizable: false,
    backgroundColor: '#000000',
    minWidth: 1024,
    minHeight: 768,
    // Frameless so the renderer draws its own titlebar and drives min/close/
    // fullscreen through the `window` IPC module.
    frame: false,
    webPreferences: {
      // The preload only touches `electron` (contextBridge + ipcRenderer), which
      // the sandbox still provides — so the renderer runs with no Node at all.
      preload: env.paths.preload,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  wireFullscreenEvents(win)

  win.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (env.production) {
    void win.loadURL(env.urls.renderer)
  } else {
    void win.loadURL(env.devServerUrl)
    // The Vite dev server may not be ready on the first attempt; retry.
    win.webContents.on('did-fail-load', () => {
      setTimeout(() => void win.loadURL(env.devServerUrl), 300)
    })
  }

  return win
}

prepare({
  onReady: async () => {
    const ipc = createIpcContainer()
    await ipc.loadAll({
      system: systemIpc,
      window: windowIpc,
      game: gameIpc
    })
  },
  protocols: env.production ? [{ scheme, handler: serveClient }] : [],
  createWindow
})
