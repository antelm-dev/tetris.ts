import '@tetris/renderer/styles.css'
import { EMPTY_RECORDS, render, type HighScores, type Host } from '@tetris/renderer'
import appPackage from '../../package.json'

const CHANGELOG_URL = 'https://github.com/antelm-dev/tetris.ts/blob/main/CHANGELOG.md'

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

/** Same-origin by default (Vite `/api` proxy for records). Override for Nest online API. */
const host: Host = {
  apiOrigin: import.meta.env.VITE_API_ORIGIN || undefined,
  getVersion: async () => appPackage.version,
  openChangelog: () => window.open(CHANGELOG_URL, '_blank', 'noopener')
}

window.addEventListener('DOMContentLoaded', () => {
  // No `quit` on Host: there's no window to close in a browser tab, so `Menu`
  // hides the Quit row automatically (see `hud/menu/Menu.ts`).
  render(document.getElementById('root')!, scores, host, true)
})
