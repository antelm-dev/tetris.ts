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
  /** Signed-in display name, for the lobby header. */
  userName: string | null
}

// --- lobby card entries ------------------------------------------------------

export type LobbyFieldId = 'email' | 'password' | 'regName' | 'regEmail' | 'regPassword' | 'roomName' | 'roomId'

export type LobbyActionId =
  | 'login'
  | 'register'
  | 'connect'
  | 'create-room'
  | 'join-room'
  | 'toggle-ready'
  | 'start'
  | 'leave-room'
  | 'copy-room'
  | 'exit'

export type LobbyEntry =
  | { kind: 'heading'; label: string }
  | { kind: 'gap'; h: number }
  | { kind: 'note'; label: string; tone: 'error' | 'dim' }
  | { kind: 'stat'; label: string; value: string }
  | { kind: 'field'; id: LobbyFieldId; label: string; secret?: boolean; placeholder?: string }
  | { kind: 'action'; id: LobbyActionId; label: string; primary?: boolean; disabled?: boolean }

/**
 * The rows the lobby card shows for a given view — pure, so the whole screen
 * flow is testable without p5.
 */
export function buildLobbyEntries(v: OnlineLobbyView, opts: { busy?: boolean } = {}): LobbyEntry[] {
  const busy = !!opts.busy
  const out: LobbyEntry[] = []
  if (v.errorText) out.push({ kind: 'note', label: v.errorText, tone: 'error' })

  if (v.panel === 'terminal') {
    if (v.terminalSub) out.push({ kind: 'note', label: v.terminalSub, tone: 'dim' })
    out.push({ kind: 'action', id: 'exit', label: 'Back to menu', primary: true })
    return out
  }

  if (v.panel === 'auth') {
    out.push(
      { kind: 'heading', label: 'Sign in' },
      { kind: 'field', id: 'email', label: 'Email', placeholder: 'you@example.com' },
      { kind: 'field', id: 'password', label: 'Password', secret: true },
      { kind: 'action', id: 'login', label: 'Sign in', primary: true, disabled: busy },
      { kind: 'gap', h: 8 },
      { kind: 'heading', label: 'Register' },
      { kind: 'field', id: 'regName', label: 'Display name' },
      { kind: 'field', id: 'regEmail', label: 'Email', placeholder: 'you@example.com' },
      { kind: 'field', id: 'regPassword', label: 'Password', secret: true },
      { kind: 'action', id: 'register', label: 'Register', disabled: busy },
      { kind: 'gap', h: 8 },
      { kind: 'action', id: 'exit', label: 'Back to menu' }
    )
    return out
  }

  const offline = v.connection !== 'ready'
  if (v.roomId) {
    out.push({ kind: 'heading', label: 'Room' }, { kind: 'stat', label: 'Room ID', value: v.roomId })
    out.push({ kind: 'action', id: 'copy-room', label: 'Copy room ID', disabled: busy })
    out.push({ kind: 'gap', h: 8 }, { kind: 'heading', label: `Players · ${v.playerCount}/${v.maxPlayers}` })
    for (const p of v.players) {
      const who = `${p.displayName}${p.isHost ? ' · host' : ''}${p.isSelf ? ' · you' : ''}`
      out.push({ kind: 'stat', label: who, value: p.ready ? 'Ready' : 'Not ready' })
    }
    out.push({ kind: 'gap', h: 8 })
    out.push({
      kind: 'action',
      id: 'toggle-ready',
      label: v.selfReady ? 'Unready' : 'Ready',
      primary: !v.selfReady,
      disabled: busy
    })
    if (v.isHost) {
      out.push({ kind: 'action', id: 'start', label: 'Start', primary: v.canStart, disabled: busy || !v.canStart })
    }
    out.push({ kind: 'action', id: 'leave-room', label: 'Leave room', disabled: busy })
  } else {
    out.push(
      { kind: 'heading', label: 'Create' },
      { kind: 'field', id: 'roomName', label: 'Room name', placeholder: 'Private room' },
      { kind: 'action', id: 'create-room', label: 'Create private room', primary: true, disabled: busy || offline },
      { kind: 'gap', h: 8 },
      { kind: 'heading', label: 'Join' },
      { kind: 'field', id: 'roomId', label: 'Room ID', placeholder: 'paste a room ID' },
      { kind: 'action', id: 'join-room', label: 'Join by ID', disabled: busy || offline }
    )
    if (offline) out.push({ kind: 'action', id: 'connect', label: 'Reconnect', disabled: busy })
  }

  out.push({ kind: 'gap', h: 8 }, { kind: 'action', id: 'exit', label: 'Back to menu' })
  return out
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
    terminalSub,
    userName: state.user?.displayName ?? null
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
