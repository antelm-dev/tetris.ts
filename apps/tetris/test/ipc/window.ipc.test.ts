import { describe, it, expect, beforeEach } from 'vitest'
import { windowIpc, wireFullscreenEvents } from '../../main/ipc/window.ipc'
import { createFakeIpc } from './fake-ipc'
import { BrowserWindow, win } from '../mocks/electron'

const event = { sender: {} } as never

beforeEach(() => {
  BrowserWindow.fromWebContents.mockReturnValue(win)
  win.isFullScreen.mockReturnValue(false)
  win.on.mockClear()
  win.webContents.send.mockClear()
})

describe('windowIpc', () => {
  it('registers prefixed listeners (fire-and-forget)', async () => {
    const { ipc, listeners, handlers } = createFakeIpc()
    await windowIpc(ipc)
    expect([...listeners.keys()]).toEqual(['window:minimize', 'window:close', 'window:toggle-fullscreen'])
    expect(handlers.size).toBe(0)
  })

  it('minimize/close act on the sender window', async () => {
    const { ipc, listeners } = createFakeIpc()
    await windowIpc(ipc)

    listeners.get('window:minimize')!(event)
    expect(win.minimize).toHaveBeenCalledOnce()

    listeners.get('window:close')!(event)
    expect(win.close).toHaveBeenCalledOnce()
  })

  it('toggle-fullscreen flips the current fullscreen state', async () => {
    const { ipc, listeners } = createFakeIpc()
    await windowIpc(ipc)

    win.isFullScreen.mockReturnValue(false)
    listeners.get('window:toggle-fullscreen')!(event)
    expect(win.setFullScreen).toHaveBeenLastCalledWith(true)

    win.isFullScreen.mockReturnValue(true)
    listeners.get('window:toggle-fullscreen')!(event)
    expect(win.setFullScreen).toHaveBeenLastCalledWith(false)
  })

  it('does nothing if no window owns the sender', async () => {
    const { ipc, listeners } = createFakeIpc()
    await windowIpc(ipc)
    BrowserWindow.fromWebContents.mockReturnValue(null as never)
    expect(() => listeners.get('window:minimize')!(event)).not.toThrow()
  })

  it('wireFullscreenEvents forwards enter/leave to the renderer', () => {
    wireFullscreenEvents(win as never)

    expect(win.on).toHaveBeenCalledWith('enter-full-screen', expect.any(Function))
    expect(win.on).toHaveBeenCalledWith('leave-full-screen', expect.any(Function))

    const enter = win.on.mock.calls.find(([name]) => name === 'enter-full-screen')![1] as () => void
    const leave = win.on.mock.calls.find(([name]) => name === 'leave-full-screen')![1] as () => void

    enter()
    expect(win.webContents.send).toHaveBeenLastCalledWith('fullscreen-changed', true)

    leave()
    expect(win.webContents.send).toHaveBeenLastCalledWith('fullscreen-changed', false)
  })
})
