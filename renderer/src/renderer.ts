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
  const levelEl = $('hud-level')
  const linesEl = $('hud-lines')
  const overlay = $('overlay')
  const overlayTitle = $('overlay-title')
  const overlaySub = $('overlay-sub')

  const showOverlay = (title: string, sub: string, kind: string): void => {
    if (!overlay) return
    if (overlayTitle) overlayTitle.textContent = title
    if (overlaySub) overlaySub.textContent = sub
    overlay.dataset.kind = kind
    overlay.hidden = false
    void overlay.offsetWidth
    overlay.classList.add('show')
  }
  const hideOverlay = (): void => {
    overlay?.classList.remove('show')
    if (overlay) overlay.hidden = true
  }

  // Pulse a HUD stat when it changes, for a bit of tactile feedback.
  const bump = (el: HTMLElement | null, value: string | number): void => {
    if (!el) return
    el.textContent = String(value)
    el.classList.remove('bump')
    void el.offsetWidth
    el.classList.add('bump')
  }

  render(document.getElementById('root')!, {
    onScore: (score) => bump(scoreEl, score),
    onLines: (lines) => bump(linesEl, lines),
    onLevel: (level) => bump(levelEl, level),
    onPause: (paused) => {
      if (paused) showOverlay('Paused', 'Press Esc to resume', 'pause')
      else hideOverlay()
    },
    onRestart: () => hideOverlay(),
    onGameOver: (score) => {
      showOverlay('Game Over', `Score ${score} · press Space to play again`, 'over')
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
