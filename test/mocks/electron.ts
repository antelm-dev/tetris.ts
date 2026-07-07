import { vi } from 'vitest'

// Shared `electron` stub used by all IPC tests (wired via the `electron` alias
// in vitest.config.ts). Import the pieces you need and configure them per test.

export const win = {
  minimize: vi.fn(),
  close: vi.fn(),
  setFullScreen: vi.fn(),
  isFullScreen: vi.fn(() => false)
}

export const BrowserWindow = {
  fromWebContents: vi.fn(() => win)
}

export const app = {
  getVersion: vi.fn(() => '9.9.9'),
  getPath: vi.fn(() => '/userdata')
}

export const ipcMain = {}
