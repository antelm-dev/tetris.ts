import render from './tetris-p5'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

function showBanner(text: string): void {
  const banner = $('banner')
  if (!banner) return
  banner.textContent = text
  banner.hidden = false
  // reflow so the transition runs each time
  void banner.offsetWidth
  banner.classList.add('show')
  setTimeout(() => banner.classList.remove('show'), 2500)
}

window.addEventListener('DOMContentLoaded', () => {
  const bridge = window.electron?.bridge

  const scoreEl = $('hud-score')
  const bestEl = $('hud-best')

  render(document.getElementById('root')!, {
    onScore: (score) => {
      if (scoreEl) scoreEl.textContent = String(score)
    },
    onGameOver: (score) => {
      // `submitScore` persists in the main process and, if it's a record,
      // triggers the `high-score-beaten` event handled below.
      void bridge?.game.submitScore(score).then((isRecord) => {
        if (isRecord && bestEl) bestEl.textContent = String(score)
      })
    }
  })

  // Custom titlebar → fire-and-forget window controls (`listen` channels).
  $('btn-min')?.addEventListener('click', () => bridge?.window.minimize())
  $('btn-full')?.addEventListener('click', () => bridge?.window.toggleFullscreen())
  $('btn-close')?.addEventListener('click', () => bridge?.window.close())

  // Typed event pushed from the main process.
  bridge?.game.onHighScoreBeaten((score) => showBanner(`New high score: ${score}`))

  // Initial best score from disk.
  void bridge?.game.getHighScore().then((best) => {
    if (bestEl) bestEl.textContent = String(best)
  })
})
