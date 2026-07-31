import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { updateChannelForVersion } from './update-channel.js'

export type UpdateStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** Serialisable snapshot pushed to the renderer on every transition. */
export type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  /** Download completion, 0–100. Only set while downloading. */
  progress?: number
  message?: string
}

/**
 * Auto-updates only work against an *installed* build fed by an update feed:
 * the portable exe has nowhere to write, the dev build has no feed at all, and
 * the macOS artifacts are unsigned (`identity: null`), which Squirrel.Mac
 * refuses. Everything else falls back to a plain "unavailable" state so the UI
 * has something honest to show.
 */
function isSupported(): boolean {
  if (!app.isPackaged || process.env['PORTABLE_EXECUTABLE_FILE']) return false
  if (process.platform === 'win32') return true
  // Only the AppImage target self-updates; deb is owned by the system package manager.
  return process.platform === 'linux' && Boolean(process.env['APPIMAGE'])
}

/** Owns electron-updater and exposes a small state machine to IPC. */
export class UpdateController {
  private state: UpdateState
  private readonly supported = isSupported()

  constructor() {
    this.state = this.supported
      ? { status: 'idle', currentVersion: app.getVersion() }
      : {
          status: 'unavailable',
          currentVersion: app.getVersion(),
          message: app.isPackaged
            ? 'Automatic updates are only available for the installed build.'
            : 'Automatic updates are not available in development.'
        }

    if (!this.supported) return

    // Downloads are user-initiated so a background transfer never competes with
    // the game loop; the staged installer is applied on the next quit.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.channel = updateChannelForVersion(app.getVersion())
    autoUpdater.allowPrerelease = autoUpdater.channel !== 'latest'

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'available', availableVersion: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'up-to-date' }))
    autoUpdater.on('download-progress', (progress) =>
      this.set({
        status: 'downloading',
        availableVersion: this.state.availableVersion,
        progress: Math.max(0, Math.min(100, progress.percent))
      })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ status: 'downloaded', availableVersion: info.version, progress: 100 })
    )
    autoUpdater.on('error', (error) =>
      this.set({ status: 'error', availableVersion: this.state.availableVersion, message: messageOf(error) })
    )
  }

  current(): UpdateState {
    return this.state
  }

  async check(): Promise<UpdateState> {
    if (!this.supported || this.state.status === 'checking' || this.state.status === 'downloading') return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.set({ status: 'error', message: messageOf(error) })
    }
    return this.state
  }

  /**
   * Single "advance" action driven by one button in the titlebar: download what
   * was found, install what was downloaded, otherwise re-check.
   */
  async advance(): Promise<UpdateState> {
    if (!this.supported) return this.state

    if (this.state.status === 'available') {
      try {
        await autoUpdater.downloadUpdate()
      } catch (error) {
        this.set({ status: 'error', availableVersion: this.state.availableVersion, message: messageOf(error) })
      }
    } else if (this.state.status === 'downloaded') {
      autoUpdater.quitAndInstall(false, true)
    } else if (this.state.status !== 'checking' && this.state.status !== 'downloading') {
      return this.check()
    }

    return this.state
  }

  private set(patch: Omit<UpdateState, 'currentVersion'>): void {
    this.state = { currentVersion: app.getVersion(), ...patch }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update-state-changed', this.state)
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One controller per process — the update feed is global. */
export const updater = new UpdateController()
