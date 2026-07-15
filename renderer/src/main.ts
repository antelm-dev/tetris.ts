import render from './app/sketch'
import type { HighScores } from './app/host'
import { EMPTY_RECORDS } from './app/records'

/**
 * Solo records persisted through the small Express API (see `server/`)
 * rather than Electron IPC. There's no push channel for a browser tab (no
 * websocket), so `onBeaten` is a no-op — a beaten record already updates the
 * HUD synchronously through `submit`'s return value (see `app/events.ts`).
 */
const scores: HighScores = {
  get: async () => {
    try {
      const res = await fetch('/api/records')
      if (!res.ok) return EMPTY_RECORDS
      const data: { records?: unknown } = await res.json()
      return (data.records as typeof EMPTY_RECORDS) ?? EMPTY_RECORDS
    } catch {
      return EMPTY_RECORDS
    }
  },
  submit: async (payload) => {
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) return { beaten: false, records: EMPTY_RECORDS }
      return await res.json()
    } catch {
      return { beaten: false, records: EMPTY_RECORDS }
    }
  },
  onBeaten: () => {}
}

window.addEventListener('DOMContentLoaded', () => {
  // No `Host`: there's no window to quit in a browser tab, so `Menu` hides
  // the Quit row automatically (see `hud/Menu.ts`).
  render(document.getElementById('root')!, scores)
})
