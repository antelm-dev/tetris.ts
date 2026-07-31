/**
 * Renderer-owned online multiplayer client. Handles REST auth, the `/game`
 * socket namespace, lobby events, and a deterministic local match model.
 *
 * Kept free of p5 / menu wiring so it can be unit-tested headlessly. Task 02
 * owns the Online Versus UI that will call into this surface.
 *
 * Feature flag (UI only, not used here): `online_multiplayer_ui`.
 */
import { COLS, Game, ROWS, mulberry32, type Action, type GameEvents, type GameProjection } from '@tetris/engine'
import {
  ClientEvent,
  PROTOCOL_VERSION,
  ServerEvent,
  type ActionAckPayload,
  type AuthenticatePayload,
  type ConnectedPayload,
  type EliminationPayload,
  type ErrorPayload,
  type GameAction,
  type GameOverPayload,
  type GameStartedPayload,
  type GarbageDeliveryPayload,
  type PlayerActionPayload,
  type RoomCreatePayload,
  type RoomStatePayload,
  type ServerEnvelope,
  type SnapshotPayload
} from '@tetris/protocol'
import { io, type Socket } from 'socket.io-client'

export { ClientEvent, PROTOCOL_VERSION, ServerEvent }
export type {
  ErrorPayload,
  GameAction,
  GameOverPayload,
  GameStartedPayload,
  RoomCreatePayload,
  RoomStatePayload,
  SnapshotPayload
}

// ---------------------------------------------------------------------------
// Auth shapes (REST — not part of @tetris/protocol)
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  displayName: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface AuthResult {
  user: AuthUser
  tokens: AuthTokens
}

export interface RegisterInput {
  email: string
  displayName: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export type OnlineConnectionPhase = 'idle' | 'connecting' | 'authenticating' | 'ready' | 'disconnected' | 'error'

export type OnlineLobbyPhase = 'none' | 'in-room' | 'starting' | 'in-match' | 'finished'

/** Display-only opponent board — never drives local simulation. */
export interface RemoteProjection {
  userId: string
  seq: number
  score: number
  lines: number
  level: number
  board: GameProjection['board']
  activePiece?: GameProjection['activePiece']
  gameOver: boolean
}

export interface OnlineMatchState {
  roomId: string
  seed: number
  startedAt: number
  /** Local predicted engine; undefined outside an active match. */
  localGame: Game | null
  /** Highest outbound action seq that has been acknowledged. */
  lastAckedSeq: number
  /** Next seq that will be attached to a local input. */
  nextActionSeq: number
  /** Local lock counter (0-based count of locks after match start). */
  lockCount: number
  remote: RemoteProjection | null
  elimination: EliminationPayload | null
  gameOver: GameOverPayload | null
}

export interface OnlineClientState {
  connection: OnlineConnectionPhase
  lobby: OnlineLobbyPhase
  user: AuthUser | null
  sessionId: string | null
  room: RoomStatePayload | null
  match: OnlineMatchState | null
  lastError: ErrorPayload | null
  lastEnvelopeSeq: number
}

export type OnlineFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Minimal socket surface so tests can inject a fake without socket.io. */
export interface OnlineSocket {
  connected: boolean
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
  emit(event: string, ...args: unknown[]): void
  disconnect(): void
}

export type OnlineSocketFactory = (url: string) => OnlineSocket

export interface OnlineClientOptions {
  /** API base URL. Empty / undefined = same-origin. */
  apiOrigin?: string
  fetch?: OnlineFetch
  createSocket?: OnlineSocketFactory
  /** Override `Date.now` for deterministic action timestamps in tests. */
  now?: () => number
}

const EMPTY_STATE = (): OnlineClientState => ({
  connection: 'idle',
  lobby: 'none',
  user: null,
  sessionId: null,
  room: null,
  match: null,
  lastError: null,
  lastEnvelopeSeq: -1
})

function normalizeOrigin(origin: string | undefined): string {
  if (!origin) return ''
  return origin.replace(/\/$/, '')
}

function defaultSocketFactory(url: string): OnlineSocket {
  const socket: Socket = io(url, {
    autoConnect: true,
    reconnection: false,
    transports: ['websocket', 'polling']
  })
  return {
    get connected() {
      return socket.connected
    },
    on(event, listener) {
      socket.on(event, listener as (...args: unknown[]) => void)
    },
    off(event, listener) {
      socket.off(event, listener as (...args: unknown[]) => void)
    },
    emit(event, ...args) {
      socket.emit(event, ...args)
    },
    disconnect() {
      socket.disconnect()
    }
  }
}

/**
 * Hidden online match client. Construct from a host `apiOrigin` (or omit for
 * same-origin). Does nothing until auth / connect are called — solo and local
 * Versus remain unaffected (AC-05).
 */
export class OnlineClient {
  private readonly apiOrigin: string
  private readonly fetchFn: OnlineFetch
  private readonly createSocket: OnlineSocketFactory
  private readonly now: () => number

  private tokens: AuthTokens | null = null
  private socket: OnlineSocket | null = null
  private state: OnlineClientState = EMPTY_STATE()
  private readonly listeners = new Set<(state: OnlineClientState) => void>()
  private readonly boundHandlers = new Map<string, (...args: unknown[]) => void>()
  /** Garbage deliveries waiting for their lock boundary. */
  private pendingGarbage: GarbageDeliveryPayload[] = []
  private disposed = false
  private connectWaiters: {
    resolve: () => void
    reject: (err: Error) => void
  }[] = []

  public constructor(options: OnlineClientOptions = {}) {
    this.apiOrigin = normalizeOrigin(options.apiOrigin)
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.createSocket = options.createSocket ?? defaultSocketFactory
    this.now = options.now ?? Date.now
  }

  /** Snapshot of connection / lobby / match state (no socket handle). */
  public getState(): OnlineClientState {
    return this.cloneState()
  }

  public get user(): AuthUser | null {
    return this.state.user
  }

  public get room(): RoomStatePayload | null {
    return this.state.room
  }

  public get match(): OnlineMatchState | null {
    return this.state.match
  }

  public get localGame(): Game | null {
    return this.state.match?.localGame ?? null
  }

  public get remoteProjection(): RemoteProjection | null {
    return this.state.match?.remote ?? null
  }

  public get lastError(): ErrorPayload | null {
    return this.state.lastError
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  public subscribe(listener: (state: OnlineClientState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // --- Auth REST -------------------------------------------------------------

  public async register(input: RegisterInput): Promise<AuthResult> {
    return this.authPost('/api/auth/register', input)
  }

  public async login(input: LoginInput): Promise<AuthResult> {
    return this.authPost('/api/auth/login', input)
  }

  public async refresh(): Promise<AuthResult> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token in memory')
    }
    return this.authPost('/api/auth/refresh', { refreshToken: this.tokens.refreshToken })
  }

  // --- Socket lifecycle ------------------------------------------------------

  /**
   * Open `/game`, authenticate with the in-memory access token + protocol
   * version, and resolve once `server:connected` arrives.
   */
  public connect(): Promise<void> {
    this.assertAlive()
    if (!this.tokens?.accessToken || !this.state.user) {
      return Promise.reject(new Error('Authenticate via register/login before connecting'))
    }
    if (this.state.connection === 'ready' && this.socket?.connected) {
      return Promise.resolve()
    }

    // Drop any prior socket before opening a new one (no auto-reconnect).
    this.detachSocket()

    this.patch({ connection: 'connecting', lastError: null })
    const url = `${this.apiOrigin}/game`
    const socket = this.createSocket(url)
    this.socket = socket
    this.attachSocketHandlers(socket)

    this.patch({ connection: 'authenticating' })
    const auth: AuthenticatePayload = {
      protocolVersion: PROTOCOL_VERSION,
      token: this.tokens.accessToken
    }
    socket.emit(ClientEvent.Authenticate, auth)

    return new Promise<void>((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject })
    })
  }

  /** Drop the socket without clearing in-memory auth tokens. */
  public disconnect(): void {
    this.teardownSocket('disconnected')
  }

  /**
   * Full teardown: socket listeners, match state, tokens, and subscriptions.
   * Safe to call more than once.
   */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.teardownSocket('disconnected')
    this.tokens = null
    this.pendingGarbage = []
    this.state = EMPTY_STATE()
    this.listeners.clear()
    this.rejectConnectWaiters(new Error('OnlineClient disposed'))
  }

  // --- Lobby -----------------------------------------------------------------

  public createRoom(payload: RoomCreatePayload): void {
    this.requireReady()
    this.emit(ClientEvent.RoomCreate, payload)
  }

  public joinRoom(roomId: string): void {
    this.requireReady()
    this.emit(ClientEvent.RoomJoin, { roomId })
  }

  public leaveRoom(): void {
    this.requireReady()
    const roomId = this.state.room?.roomId
    if (!roomId) return
    this.emit(ClientEvent.RoomLeave, { roomId })
  }

  public setReady(ready: boolean): void {
    this.requireReady()
    const roomId = this.state.room?.roomId
    if (!roomId) return
    this.emit(ClientEvent.PlayerReady, { roomId, ready })
  }

  public startGame(): void {
    this.requireReady()
    const roomId = this.state.room?.roomId
    if (!roomId) return
    this.patch({ lobby: 'starting' })
    this.emit(ClientEvent.GameStart, { roomId })
  }

  // --- Match -----------------------------------------------------------------

  /**
   * Apply a local input immediately and emit `client:player:action`. Never
   * sends boards, scores, attacks, or results. `pause` is a no-op online
   * (server rejects it; local prediction must not pause either).
   */
  public sendAction(action: GameAction): void {
    const match = this.state.match
    if (!match?.localGame || this.state.lobby !== 'in-match') return
    if (match.gameOver || match.localGame.gameOver) return

    if (action === 'pause') {
      return
    }

    const seq = match.nextActionSeq
    match.nextActionSeq = seq + 1
    match.localGame.action(action as Action)

    const payload: PlayerActionPayload = {
      roomId: match.roomId,
      seq,
      ts: this.now(),
      action
    }
    this.emit(ClientEvent.PlayerAction, payload)
    this.notify()
  }

  /** Drive the local predicted engine (ms). Prefer this over `Game.tick`. */
  public advance(dtMs: number): void {
    const game = this.state.match?.localGame
    if (!game || this.state.lobby !== 'in-match') return
    if (this.state.match?.gameOver) return
    game.advance(dtMs)
    this.notify()
  }

  /** Clear match / lobby bookkeeping after game-over or a manual return. */
  public clearMatch(): void {
    this.clearMatchInternal()
    this.patch({
      lobby: this.state.room ? 'in-room' : 'none',
      match: null
    })
  }

  /**
   * Compose additional local `Game` listeners without dropping the client's
   * lock / garbage handlers. Presentation (task 02) should use this instead of
   * assigning `game.events` wholesale.
   */
  public wireLocalEvents(partial: GameEvents): void {
    const game = this.state.match?.localGame
    if (!game) return
    const previous = game.events
    const next: GameEvents = { ...previous, ...partial }
    if (partial.onLock) {
      const prior = previous.onLock
      const added = partial.onLock
      next.onLock = (hard) => {
        prior?.(hard)
        added(hard)
      }
    }
    game.events = next
  }

  // --- Internals -------------------------------------------------------------

  private async authPost(path: string, body: unknown): Promise<AuthResult> {
    this.assertAlive()
    const res = await this.fetchFn(`${this.apiOrigin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Auth failed (${res.status}): ${text || res.statusText}`)
    }
    const result = (await res.json()) as AuthResult
    this.tokens = result.tokens
    this.patch({ user: result.user, lastError: null })
    return result
  }

  private attachSocketHandlers(socket: OnlineSocket): void {
    const on = (event: string, handler: (...args: unknown[]) => void) => {
      this.boundHandlers.set(event, handler)
      socket.on(event, handler)
    }

    on('connect_error', (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Socket connection failed'
      this.failConnect(message)
      this.patch({
        connection: 'error',
        lastError: { code: 'CONNECT_ERROR', message }
      })
    })

    on('disconnect', () => {
      if (this.disposed) return
      this.clearMatchInternal()
      this.rejectConnectWaiters(new Error('Socket disconnected'))
      this.patch({
        connection: 'disconnected',
        lobby: 'none',
        room: null,
        match: null,
        sessionId: null
      })
    })

    on(ServerEvent.Connected, (raw: unknown) => {
      const env = this.asEnvelope<ConnectedPayload>(raw)
      if (!env) return
      this.patch({
        connection: 'ready',
        sessionId: env.data.sessionId,
        lastError: null
      })
      this.resolveConnectWaiters()
    })

    on(ServerEvent.Error, (raw: unknown) => {
      const env = this.asEnvelope<ErrorPayload>(raw)
      if (!env) return
      this.patch({ lastError: env.data })
      if (this.state.connection === 'authenticating' || this.state.connection === 'connecting') {
        this.failConnect(env.data.message)
        this.patch({ connection: 'error' })
      }
    })

    on(ServerEvent.RoomCreated, (raw: unknown) => {
      const env = this.asEnvelope<RoomStatePayload>(raw)
      if (!env) return
      this.patch({ room: env.data, lobby: 'in-room' })
    })

    on(ServerEvent.RoomJoined, (raw: unknown) => {
      const env = this.asEnvelope<RoomStatePayload>(raw)
      if (!env) return
      this.patch({ room: env.data, lobby: 'in-room' })
    })

    on(ServerEvent.RoomState, (raw: unknown) => {
      const env = this.asEnvelope<RoomStatePayload>(raw)
      if (!env) return
      let lobby: OnlineLobbyPhase = 'in-room'
      if (env.data.status === 'in-progress') lobby = this.state.match ? 'in-match' : 'starting'
      else if (env.data.status === 'finished') lobby = 'finished'
      this.patch({ room: env.data, lobby })
    })

    on(ServerEvent.RoomLeft, (raw: unknown) => {
      this.trackEnvelope(raw)
      this.clearMatchInternal()
      this.patch({ room: null, lobby: 'none', match: null })
    })

    on(ServerEvent.GameStarted, (raw: unknown) => {
      const env = this.asEnvelope<GameStartedPayload>(raw)
      if (!env) return
      this.beginMatch(env.data)
    })

    on(ServerEvent.ActionAcknowledged, (raw: unknown) => {
      const env = this.asEnvelope<ActionAckPayload>(raw)
      if (!env || !this.state.match) return
      if (env.data.roomId !== this.state.match.roomId) return
      if (env.data.seq > this.state.match.lastAckedSeq) {
        this.state.match.lastAckedSeq = env.data.seq
        this.notify()
      }
    })

    on(ServerEvent.Snapshot, (raw: unknown) => {
      const env = this.asEnvelope<SnapshotPayload>(raw)
      if (!env || !this.state.match) return
      this.applySnapshot(env.data)
    })

    on(ServerEvent.GarbageDelivered, (raw: unknown) => {
      const env = this.asEnvelope<GarbageDeliveryPayload>(raw)
      if (!env || !this.state.match) return
      this.queueGarbage(env.data)
    })

    on(ServerEvent.Elimination, (raw: unknown) => {
      const env = this.asEnvelope<EliminationPayload>(raw)
      if (!env || !this.state.match) return
      if (env.data.roomId !== this.state.match.roomId) return
      this.state.match.elimination = env.data
      this.notify()
    })

    on(ServerEvent.GameOver, (raw: unknown) => {
      const env = this.asEnvelope<GameOverPayload>(raw)
      if (!env || !this.state.match) return
      if (env.data.roomId !== this.state.match.roomId) return
      this.state.match.gameOver = env.data
      this.patch({ lobby: 'finished' })
    })
  }

  private beginMatch(payload: GameStartedPayload): void {
    this.clearMatchInternal()
    const game = new Game({
      width: COLS,
      height: ROWS,
      random: mulberry32(payload.seed)
    })
    const previousEvents = game.events
    const previousOnLock = previousEvents.onLock
    game.events = {
      ...previousEvents,
      onLock: (hard) => {
        previousOnLock?.(hard)
        const match = this.state.match
        if (!match) return
        match.lockCount += 1
        this.flushGarbage()
        this.notify()
      }
    }
    game.start()

    const match: OnlineMatchState = {
      roomId: payload.roomId,
      seed: payload.seed,
      startedAt: payload.startedAt,
      localGame: game,
      lastAckedSeq: -1,
      nextActionSeq: 0,
      lockCount: 0,
      remote: null,
      elimination: null,
      gameOver: null
    }
    this.pendingGarbage = []
    this.patch({ match, lobby: 'in-match', room: this.state.room })
  }

  private applySnapshot(payload: SnapshotPayload): void {
    const match = this.state.match
    if (!match || payload.roomId !== match.roomId) return
    const me = this.state.user?.id
    if (me && payload.userId === me) return

    const prev = match.remote
    if (prev && prev.userId === payload.userId && payload.seq <= prev.seq) {
      // Stale / duplicate opponent snapshot — keep the fresher projection.
      return
    }

    match.remote = {
      userId: payload.userId,
      seq: payload.seq,
      score: payload.score,
      lines: payload.lines,
      level: payload.level,
      board: payload.board,
      activePiece: payload.activePiece,
      gameOver: payload.gameOver
    }
    this.notify()
  }

  private queueGarbage(payload: GarbageDeliveryPayload): void {
    const match = this.state.match
    const me = this.state.user?.id
    if (!match || !me) return
    if (payload.roomId !== match.roomId) return
    if (payload.toUserId !== me) return
    // Enqueue only — drain exclusively from the local onLock path so rows
    // never insert while a piece is active (AC-03), even when appliedAtLock
    // is already in the past (apply at the *next* lock).
    this.pendingGarbage.push(payload)
  }

  /**
   * Apply queued deliveries whose `appliedAtLock` has been reached. Uses the
   * wire hole list — never regenerates holes from local RNG. Called only from
   * the composed local `onLock` handler.
   */
  private flushGarbage(): void {
    const match = this.state.match
    const game = match?.localGame
    if (!match || !game) return

    const remaining: GarbageDeliveryPayload[] = []
    for (const delivery of this.pendingGarbage) {
      if (delivery.appliedAtLock <= match.lockCount) {
        game.receiveGarbage(delivery.rows)
      } else {
        remaining.push(delivery)
      }
    }
    this.pendingGarbage = remaining
  }

  private clearMatchInternal(): void {
    this.pendingGarbage = []
    if (this.state.match?.localGame) {
      this.state.match.localGame.events = {}
    }
  }

  /** Unregister handlers and disconnect the current socket instance, if any. */
  private detachSocket(): void {
    const socket = this.socket
    if (!socket) return
    for (const [event, handler] of this.boundHandlers) {
      socket.off(event, handler)
    }
    this.boundHandlers.clear()
    socket.disconnect()
    this.socket = null
  }

  private teardownSocket(connection: OnlineConnectionPhase): void {
    this.detachSocket()
    this.clearMatchInternal()
    this.rejectConnectWaiters(new Error('Socket closed'))
    this.patch({
      connection,
      lobby: 'none',
      room: null,
      match: null,
      sessionId: null
    })
  }

  private emit(event: string, payload: unknown): void {
    this.socket?.emit(event, payload)
  }

  private requireReady(): void {
    this.assertAlive()
    if (this.state.connection !== 'ready' || !this.socket) {
      throw new Error('Socket not authenticated')
    }
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('OnlineClient disposed')
  }

  private asEnvelope<T>(raw: unknown): ServerEnvelope<T> | null {
    if (!raw || typeof raw !== 'object') return null
    const env = raw as ServerEnvelope<T>
    if (typeof env.seq !== 'number' || typeof env.ts !== 'number' || !('data' in env)) return null
    if (env.seq > this.state.lastEnvelopeSeq) {
      this.state.lastEnvelopeSeq = env.seq
    }
    return env
  }

  private trackEnvelope(raw: unknown): void {
    this.asEnvelope(raw)
  }

  private resolveConnectWaiters(): void {
    const waiters = this.connectWaiters
    this.connectWaiters = []
    for (const w of waiters) w.resolve()
  }

  private rejectConnectWaiters(err: Error): void {
    const waiters = this.connectWaiters
    this.connectWaiters = []
    for (const w of waiters) w.reject(err)
  }

  private failConnect(message: string): void {
    this.rejectConnectWaiters(new Error(message))
  }

  private patch(partial: Partial<OnlineClientState>): void {
    this.state = { ...this.state, ...partial }
    this.notify()
  }

  private notify(): void {
    const snapshot = this.cloneState()
    for (const listener of this.listeners) listener(snapshot)
  }

  private cloneState(): OnlineClientState {
    const match = this.state.match
    return {
      ...this.state,
      user: this.state.user ? { ...this.state.user } : null,
      room: this.state.room
        ? { ...this.state.room, players: this.state.room.players.map((p) => structuredClone(p)) }
        : null,
      match: match
        ? {
            ...match,
            remote: match.remote ? { ...match.remote, board: match.remote.board.map((row) => [...row]) } : null,
            elimination: match.elimination ? { ...match.elimination } : null,
            gameOver: match.gameOver
              ? {
                  ...match.gameOver,
                  standings: match.gameOver.standings.map((s) => structuredClone(s))
                }
              : null
          }
        : null,
      lastError: this.state.lastError ? { ...this.state.lastError } : null
    }
  }
}

/** Convenience: build a client from a {@link Host}-like api origin. */
export function createOnlineClient(
  apiOrigin?: string,
  options: Omit<OnlineClientOptions, 'apiOrigin'> = {}
): OnlineClient {
  return new OnlineClient({ ...options, apiOrigin })
}
