import '@tetris/renderer/styles.css'
import { render, type Host } from '@tetris/renderer'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

window.addEventListener('DOMContentLoaded', () => {
  const bridge = window.electron?.bridge

  const host: Host | undefined = bridge
    ? {
        quit: () => bridge.window.close(),
        // Electron has no same-origin API; point at the Nest online service.
        apiOrigin: import.meta.env.VITE_API_ORIGIN || undefined
      }
    : import.meta.env.VITE_API_ORIGIN
      ? { apiOrigin: import.meta.env.VITE_API_ORIGIN }
      : undefined

  // The menu, HUD, legend, overlays and banners are drawn by p5 (see hud/);
  // the renderer only injects high-score persistence, the menu's Quit action,
  // and wires the frameless titlebar, which stays in HTML/CSS so it keeps its
  // native drag region.
  render(
    document.getElementById('root')!,
    bridge && {
      get: () => bridge.game.getRecords(),
      submit: (payload) => bridge.game.submitRecord(payload),
      onBeaten: (cb) =>
        bridge.game.onRecordBeaten((payload: { mode: Parameters<typeof cb>[0]; records: Parameters<typeof cb>[1] }) =>
          cb(payload.mode, payload.records)
        )
    },
    host
  )

  // Custom titlebar → fire-and-forget window controls (`listen` channels).
  $('btn-min')?.addEventListener('click', () => bridge?.window.minimize())
  $('btn-full')?.addEventListener('click', () => bridge?.window.toggleFullscreen())
  $('btn-close')?.addEventListener('click', () => bridge?.window.close())

  bridge?.window.onFullscreenChanged((fullscreen: boolean) => {
    document.body.classList.toggle('is-fullscreen', fullscreen)
  })

  // Auto-update widget. The main process owns the state machine (see
  // main/core/updater.ts); this only mirrors it into the titlebar. States with
  // nothing worth saying ('idle', 'up-to-date', 'unavailable') stay hidden.
  if (bridge) {
    const box = $('update')
    const label = $('update-text')
    const action = $<HTMLButtonElement>('update-action')

    type UpdateState = Awaited<ReturnType<typeof bridge.update.state>>

    const describe = (state: UpdateState): string | null => {
      switch (state.status) {
        case 'checking':
          return 'Checking for updates…'
        case 'available':
          return `Version ${state.availableVersion} available`
        case 'downloading':
          return `Downloading… ${Math.round(state.progress ?? 0)}%`
        case 'downloaded':
          return `Version ${state.availableVersion} ready`
        case 'error':
          return `Update failed: ${state.message ?? 'unknown error'}`
        default:
          return null
      }
    }

    const paint = (state: UpdateState) => {
      if (!box || !label || !action) return
      const text = describe(state)
      box.hidden = text === null
      if (text === null) return
      label.textContent = text
      const verb = state.status === 'available' ? 'Download' : state.status === 'downloaded' ? 'Restart' : null
      action.hidden = verb === null
      if (verb) action.textContent = verb
    }

    action?.addEventListener('click', () => bridge.update.advance())
    bridge.update.onUpdateStateChanged(paint)
    void bridge.update.state().then(paint)
  }
})
