import type { OnlineClientState, OnlineConnectionPhase, OnlineLobbyPhase } from '../../app/online'

/** Pure lobby presentation model — unit-testable without p5 or the DOM. */

export type OnlineOverlayPanel = 'auth' | 'lobby' | 'match-hidden' | 'terminal'

export interface OnlineLobbyView {
  panel: OnlineOverlayPanel
  connection: OnlineConnectionPhase
  lobby: OnlineLobbyPhase
  /** Human-readable status line for the footer / banner. */
  statusText: string
  /** Recoverable error message, if any. */
  errorText: string | null
  roomId: string | null
  isHost: boolean
  /** Local player's ready flag when in a room. */
  selfReady: boolean
  /** Both seats filled and every connected player ready. */
  canStart: boolean
  /** Enough players to start (host button eligibility besides ready). */
  playerCount: number
  maxPlayers: number
  players: Array<{ userId: string; displayName: string; ready: boolean; isHost: boolean; isSelf: boolean }>
  /** Match ended or connection dropped while an online scene was active. */
  terminalTitle: string | null
  terminalSub: string | null
}

export function authPanelFromClient(state: OnlineClientState): boolean {
  return !!state.user
}

export function buildOnlineLobbyView(
  state: OnlineClientState,
  opts: { matchSceneActive?: boolean } = {}
): OnlineLobbyView {
  const userId = state.user?.id
  const room = state.room
  const players =
    room?.players.map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      ready: p.ready,
      isHost: p.userId === room.hostUserId,
      isSelf: p.userId === userId
    })) ?? []

  const self = players.find((p) => p.isSelf)
  const isHost = !!userId && room?.hostUserId === userId
  const playerCount = players.length
  const allReady = playerCount >= 2 && players.every((p) => p.ready)
  const canStart = isHost && allReady && state.connection === 'ready' && state.lobby === 'in-room'

  let panel: OnlineOverlayPanel = 'auth'
  if (!state.user) {
    panel = 'auth'
  } else if (opts.matchSceneActive && (state.lobby === 'in-match' || state.lobby === 'starting')) {
    panel = 'match-hidden'
  } else if (state.lobby === 'finished') {
    panel = 'terminal'
  } else if (state.connection === 'disconnected' || state.connection === 'error') {
    panel = opts.matchSceneActive ? 'terminal' : 'lobby'
  } else {
    panel = 'lobby'
  }

  // Refine terminal panel when match is over or connection died mid-match.
  let terminalTitle: string | null = null
  let terminalSub: string | null = null
  if (state.match?.gameOver) {
    panel = opts.matchSceneActive ? 'match-hidden' : panel
    const standings = state.match.gameOver.standings
    const selfStanding = standings.find((s) => s.userId === userId)
    const won = selfStanding?.place === 1
    terminalTitle = won ? 'YOU WIN' : 'YOU LOSE'
    terminalSub = standings.map((s) => `${s.userId}: ${s.score}`).join('  ·  ')
  } else if (opts.matchSceneActive && (state.connection === 'disconnected' || state.connection === 'error')) {
    terminalTitle = 'DISCONNECTED'
    terminalSub = state.lastError?.message ?? 'Connection closed'
  } else if (state.match?.elimination && state.match.elimination.userId === userId) {
    terminalTitle = 'ELIMINATED'
    terminalSub = 'Waiting for match to end…'
  }

  const statusText = statusLine(state)
  const errorText = state.lastError ? `${state.lastError.code}: ${state.lastError.message}` : null

  return {
    panel,
    connection: state.connection,
    lobby: state.lobby,
    statusText,
    errorText,
    roomId: room?.roomId ?? null,
    isHost,
    selfReady: self?.ready ?? false,
    canStart,
    playerCount,
    maxPlayers: room?.maxPlayers ?? 2,
    players,
    terminalTitle,
    terminalSub
  }
}

function statusLine(state: OnlineClientState): string {
  if (state.connection === 'connecting') return 'Connecting…'
  if (state.connection === 'authenticating') return 'Authenticating…'
  if (state.connection === 'disconnected') return 'Disconnected'
  if (state.connection === 'error') return state.lastError?.message ?? 'Connection error'
  if (state.lobby === 'starting') return 'Starting match…'
  if (state.lobby === 'in-match') return 'Match in progress'
  if (state.lobby === 'finished') return 'Match finished'
  if (state.lobby === 'in-room') {
    const n = state.room?.players.length ?? 0
    const max = state.room?.maxPlayers ?? 2
    if (n < max) return `Waiting for opponent (${n}/${max})…`
    const ready = state.room?.players.filter((p) => p.ready).length ?? 0
    return `Lobby · ${ready}/${n} ready`
  }
  if (state.user && state.connection === 'ready') return 'Connected · create or join a private room'
  if (state.user) return 'Signed in · connect to continue'
  return 'Sign in or register to play Online Versus'
}

/**
 * Decide whether the sketch should enter / leave the online play scene.
 * Pure helper so tests can cover lifecycle without p5.
 */
export type OnlineSceneAction = 'none' | 'enter-match' | 'leave-to-menu'

export function nextOnlineSceneAction(
  prev: { sceneIsOnline: boolean; lobby: OnlineLobbyPhase },
  next: OnlineClientState
): OnlineSceneAction {
  if (!prev.sceneIsOnline && next.lobby === 'in-match' && next.match?.localGame) {
    return 'enter-match'
  }
  if (prev.sceneIsOnline && next.connection === 'disconnected') {
    // Keep the scene so HUD can show disconnect; caller returns to menu on key.
    return 'none'
  }
  if (prev.sceneIsOnline && next.lobby === 'none' && !next.match) {
    return 'leave-to-menu'
  }
  return 'none'
}
