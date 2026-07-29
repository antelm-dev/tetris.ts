/**
 * Feature flag for the Online Versus menu route and lobby overlay.
 * The match client itself stays inert until the Online path is selected (AC-05).
 *
 * Enable locally with `VITE_ONLINE_MULTIPLAYER_UI=1` in `.env.web` / `.env.electron`.
 */
export function isOnlineMultiplayerUiEnabled(): boolean {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_ONLINE_MULTIPLAYER_UI === '1'
  } catch {
    return false
  }
}
