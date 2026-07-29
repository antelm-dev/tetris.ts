/**
 * Feature flag for the Online Versus menu route and lobby overlay.
 * The match client itself stays inert until the Online path is selected (AC-05).
 *
 * Enable locally with `VITE_ONLINE_MULTIPLAYER_UI=1` in a gitignored
 * `.env.web.local` / `.env.electron.local` (see the committed `.env.*.example`).
 */

/** Pure parser for unit tests — true only when the value is exactly `'1'`. */
export function parseOnlineFlag(env: Record<string, unknown> | undefined | null): boolean {
  return env?.VITE_ONLINE_MULTIPLAYER_UI === '1'
}

export function isOnlineMultiplayerUiEnabled(): boolean {
  try {
    return parseOnlineFlag(import.meta.env)
  } catch {
    return false
  }
}
