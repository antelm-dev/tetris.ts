import { vi } from 'vitest'
import type { IpcMain } from 'electron'

type Fn = (...args: any[]) => any

/**
 * A stand-in for `ipcMain` that records what a module registers. Pass `ipc` to
 * a module's register function, then invoke the captured `handlers` (from
 * `handle`/`handleOnce`) or `listeners` (from `on`/`once`) directly.
 */
export function createFakeIpc() {
  const handlers = new Map<string, Fn>()
  const listeners = new Map<string, Fn>()

  const ipc = {
    handle: vi.fn((channel: string, fn: Fn) => handlers.set(channel, fn)),
    handleOnce: vi.fn((channel: string, fn: Fn) => handlers.set(channel, fn)),
    on: vi.fn((channel: string, fn: Fn) => listeners.set(channel, fn)),
    once: vi.fn((channel: string, fn: Fn) => listeners.set(channel, fn)),
    removeHandler: vi.fn(),
    removeListener: vi.fn()
  }

  return { ipc: ipc as unknown as IpcMain, handlers, listeners }
}
