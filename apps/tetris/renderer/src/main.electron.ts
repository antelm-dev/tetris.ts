import '@tetris/renderer/styles.css'
import { render } from '@tetris/renderer'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

window.addEventListener('DOMContentLoaded', () => {
  const bridge = window.electron?.bridge

  // The menu, HUD, legend, overlays and banners are drawn by p5 (see hud/);
  // the renderer only injects high-score persistence, the menu's Quit action,
  // and wires the frameless titlebar, which stays in HTML/CSS so it keeps its
  // native drag region.
  render(
    document.getElementById('root')!,
    bridge && {
      get: () => bridge.game.getRecords(),
      submit: (payload) => bridge.game.submitRecord(payload),
      onBeaten: (cb) => bridge.game.onRecordBeaten(({ mode, records }) => cb(mode, records))
    },
    bridge && { quit: () => bridge.window.close() }
  )

  // Custom titlebar → fire-and-forget window controls (`listen` channels).
  $('btn-min')?.addEventListener('click', () => bridge?.window.minimize())
  $('btn-full')?.addEventListener('click', () => bridge?.window.toggleFullscreen())
  $('btn-close')?.addEventListener('click', () => bridge?.window.close())

  bridge?.window.onFullscreenChanged((fullscreen) => {
    document.body.classList.toggle('is-fullscreen', fullscreen)
  })
})
