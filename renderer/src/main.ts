import render from './app/sketch'

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
      get: () => bridge.game.getHighScore(),
      submit: (score) => bridge.game.submitScore(score),
      onBeaten: (cb) => bridge.game.onHighScoreBeaten(cb)
    },
    bridge && { quit: () => bridge.window.close() }
  )

  // Custom titlebar → fire-and-forget window controls (`listen` channels).
  $('btn-min')?.addEventListener('click', () => bridge?.window.minimize())
  $('btn-full')?.addEventListener('click', () => bridge?.window.toggleFullscreen())
  $('btn-close')?.addEventListener('click', () => bridge?.window.close())
})
