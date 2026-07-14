import render from './app/sketch'
import type { HighScores } from './app/host'

/**
 * High scores persisted through the small Express API (see `server/`) rather
 * than Electron IPC. There's no push channel for a browser tab (no
 * websocket), so `onBeaten` is a no-op — a beaten record already updates the
 * HUD synchronously through `submit`'s return value (see `app/events.ts`).
 */
const scores: HighScores = {
  get: async () => {
    try {
      const res = await fetch('/api/high-score')
      if (!res.ok) return 0
      const data: { highScore?: unknown } = await res.json()
      return typeof data.highScore === 'number' ? data.highScore : 0
    } catch {
      return 0
    }
  },
  submit: async (score) => {
    try {
      const res = await fetch('/api/high-score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score })
      })
      if (!res.ok) return false
      const data: { beaten?: unknown } = await res.json()
      return data.beaten === true
    } catch {
      return false
    }
  },
  onBeaten: () => {}
}

window.addEventListener('DOMContentLoaded', () => {
  // No `Host`: there's no window to quit in a browser tab, so `Menu` hides
  // the Quit row automatically (see `hud/Menu.ts`).
  render(document.getElementById('root')!, scores)
})
