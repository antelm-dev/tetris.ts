/**
 * Renderer-owned online multiplayer client. Handles REST auth, the `/game`
 * socket namespace, lobby events, and a deterministic local match model.
 *
 * Kept free of p5 / menu wiring so it can be unit-tested headlessly. Task 02
 * owns the Online Versus UI that will call into this surface.
 *
 * Feature flag (UI only, not used here): `online_multiplayer_ui`.
 */
import {
  COLS,
  Game,
  ROWS,
  mulberry32,
  type Action,
  type GameEvents,
  type GameProjection,
  type GameState,
  type GarbageRow,
  type Slot
} from '@tetris/engine'
import {
  ClientEvent,
  PROTOCOL_VERSION,
  ROLLBACK_WINDOW_TICKS,
  ServerEvent,
  TICK_MS,
  tickAt,
  type ActionAckPayload,
  type AuthenticatePayload,
  type ConnectedPayload,
  type EliminationPayload,
  type ErrorPayload,
  type GameAction,
  type GameOverPayload,
  type GameStartedPayload,
  type GarbageDeliveryPayload,
  type PingPayload,
  type PlayerActionPayload,
  type PongPayload,
  type RoomCreatePayload,
  type RoomStatePayload,
  type ServerEnvelope,
  type SnapshotPayload,
  type StateCorrectionPayload
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

/** An input bound to the tick it is simulated on, locally and on the server. */
interface ScheduledInput {
  seq: number
  action: GameAction
}

/** Everything needed to resume the local simulation from one tick boundary. */
interface TickHistory {
  state: GameState
  pending: GarbageRow[]
}

export interface OnlineMatchState {
  roomId: string
  seed: number
  startedAt: number
  /** Milliseconds per tick, as declared by the server. */
  tickMs: number
  /** How far the server will rewind for a late input. */
  rollbackWindowTicks: number
  /** Local predicted engine; undefined outside an active match. */
  localGame: Game | null
  /** Highest tick simulated locally; -1 before the first step. */
  tick: number
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

/**
 * Cap on ticks simulated in one {@link OnlineClient.pump}. A long stall (alt-tab,
 * a slow frame, a laptop lid) must not dump seconds of gameplay into one frame;
 * the server's own loop clamps the same way, and the correction channel closes
 * whatever gap the clamp opens.
 */
const MAX_CATCHUP_TICKS = 6

/**
 * How many ticks of history to retain (~1 s). Must comfortably exceed the
 * server's rollback window, since corrections arrive at a confirmed tick that is
 * already a window behind the live one.
 */
const HISTORY_TICKS = 60

/** Clock-sync probe interval. Cheap, and drift is slow. */
const CLOCK_SYNC_INTERVAL_MS = 2000

/**
 * Whether two states agree on everything that affects the simulation.
 *
 * Enumerates the *union of both objects' own keys* rather than a hand-written
 * field list. Every field of `GameState` exists because it changes what happens
 * next, so any field this comparison skips is a real divergence the correction
 * channel would silently discard — and a hand-written list quietly stops
 * covering a field the moment someone adds one. Hidden state (`lowestRow`, the
 * spin flags, `gravityAccMs`) is exactly the kind that reads as equal on screen
 * and diverges at the next lock.
 *
 * Compared structurally rather than via `JSON.stringify` because key order is
 * not guaranteed across a wire round trip, and a false mismatch would trigger a
 * pointless (and visible) replay on every correction.
 */
export function statesAgree(a: GameState, b: GameState): boolean {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = (a as unknown as Record<string, unknown>)[key]
    const right = (b as unknown as Record<string, unknown>)[key]
    if (key === 'board') {
      if (!gridsAgree(left as Slot[][], right as Slot[][])) return false
      continue
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!listsAgree(left, right)) return false
      continue
    }
    if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
      // Nested records (`activePiece`) — one level is all `GameState` has.
      if (!statesAgree(left as GameState, right as GameState)) return false
      continue
    }
    if (left !== right) return false
  }
  return true
}

/** Row-for-row, cell-for-cell — including differing heights or row widths. */
function gridsAgree(a: Slot[][] | undefined, b: Slot[][] | undefined): boolean {
  if (!a || !b) return a === b
  if (a.length !== b.length) return false
  return a.every((row, y) => {
    const other = b[y]
    return !!other && row.length === other.length && row.every((cell, x) => cell === other[x])
  })
}

function listsAgree(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  return a.every((value, i) => value === b[i])
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
  /** Tick -> inputs applied at the start of that tick. */
  private readonly inputs = new Map<number, ScheduledInput[]>()
  /** Tick -> garbage rows that become eligible to enter the well. */
  private readonly garbage = new Map<number, GarbageRow[]>()
  /** Tick -> resumable state, for rewinding when the server corrects us. */
  private readonly history = new Map<number, TickHistory>()
  /** Rows eligible but not yet inserted — held until the next lock. */
  private pendingGarbage: GarbageRow[] = []
  /** Whether a piece locked during the tick currently being simulated. */
  private lockedThisTick = false
  /** True while re-simulating, so bookkeeping does not notify per replayed tick. */
  private replaying = false
  /** Add to a local timestamp to get server time. See {@link applyPong}. */
  private clockOffsetMs = 0
  /**
   * Last authoritative tick reading and when it was taken locally — the anchor
   * local pacing extrapolates from. Null until the first pong of a match.
   */
  private anchor: { serverTick: number; atLocalMs: number } | null = null
  /** Lowest round trip seen; the sample the offset is derived from. */
  private bestRtt = Number.POSITIVE_INFINITY
  private pingTimer: ReturnType<typeof setInterval> | null = null
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
   * Schedule a local input on the next tick and tell the server which tick that
   * was. Never sends boards, scores, attacks, or results. `pause` is a no-op
   * online (server rejects it; local prediction must not pause either).
   *
   * The input is stamped rather than applied "now": the server honors the stamp
   * and rewinds if the packet arrives late, so both simulations run the action
   * on the same tick no matter what the network did to it. The wait is at most
   * one tick (~16 ms), so this costs no perceptible input lag.
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
    const applyTick = match.tick + 1
    this.schedule(applyTick, { seq, action })

    const payload: PlayerActionPayload = {
      roomId: match.roomId,
      seq,
      applyTick,
      ts: this.now(),
      action
    }
    this.emit(ClientEvent.PlayerAction, payload)
    this.notify()
  }

  /**
   * Advance the local simulation to the tick the server should be on right now.
   *
   * Deliberately *not* driven by frame delta. A variable step makes two engines
   * that received identical inputs land on different boards — which is exactly
   * how a player's own screen and their opponent's view of it came to disagree.
   * Ticks are whole and fixed-size; only how many run per frame varies.
   */
  public pump(nowMs: number = this.now()): void {
    const match = this.state.match
    if (!match?.localGame || this.state.lobby !== 'in-match' || match.gameOver) return

    const target = this.targetTick(match, nowMs)
    let steps = 0
    while (match.tick < target && steps < MAX_CATCHUP_TICKS) {
      this.stepTick(match.tick + 1)
      steps++
    }
    if (steps > 0) this.notify()
  }

  /**
   * The tick the server is expected to be on right now.
   *
   * Paced against the server's *reported* tick, not wall clock. The two are not
   * interchangeable: the authoritative loop clamps catch-up and deliberately
   * drops simulated time when it falls behind, so after any stall its tick sits
   * permanently below what elapsed wall time implies. Pacing on wall time alone
   * lets the client run away — stamping inputs for ticks the server reaches much
   * later, or never — and no correction repairs that, because the anchor itself
   * is what is wrong.
   *
   * Falls back to wall clock only until the first pong establishes an anchor.
   */
  private targetTick(match: OnlineMatchState, nowMs: number): number {
    if (!this.anchor) return tickAt(nowMs + this.clockOffsetMs, match.startedAt)
    const elapsed = Math.max(0, nowMs - this.anchor.atLocalMs)
    return this.anchor.serverTick + Math.floor(elapsed / match.tickMs)
  }

  /**
   * Legacy millisecond advance, kept for callers that drive the engine directly.
   * Prefer {@link pump}: this one advances raw time and does not sit on the
   * shared tick timeline, so it cannot be reconciled with the server.
   */
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
      // Start syncing clocks now rather than at match start, so the first
      // inputs of a match are already stamped against a converged estimate
      // instead of being clamped while the first probes land.
      this.startClockSync()
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

    on(ServerEvent.Pong, (raw: unknown) => {
      const env = this.asEnvelope<PongPayload>(raw)
      if (!env) return
      this.applyPong(env.data)
    })

    on(ServerEvent.ActionAcknowledged, (raw: unknown) => {
      const env = this.asEnvelope<ActionAckPayload>(raw)
      if (!env || !this.state.match) return
      if (env.data.roomId !== this.state.match.roomId) return
      // A clamped input missed the tick we predicted it on. Move it to where the
      // server actually ran it; the correction that follows rebuilds the board.
      if (env.data.clamped) this.rescheduleClamped(env.data)
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

    on(ServerEvent.StateCorrection, (raw: unknown) => {
      const env = this.asEnvelope<StateCorrectionPayload>(raw)
      if (!env || !this.state.match) return
      this.applyCorrection(env.data)
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
        this.onLocked()
      }
    }
    game.start()

    const match: OnlineMatchState = {
      roomId: payload.roomId,
      seed: payload.seed,
      startedAt: payload.startedAt,
      tickMs: payload.tickMs || TICK_MS,
      rollbackWindowTicks: payload.rollbackWindowTicks || ROLLBACK_WINDOW_TICKS,
      localGame: game,
      tick: -1,
      lastAckedSeq: -1,
      nextActionSeq: 0,
      lockCount: 0,
      remote: null,
      elimination: null,
      gameOver: null
    }
    this.inputs.clear()
    this.garbage.clear()
    this.history.clear()
    this.pendingGarbage = []
    // Tick -1 is the pre-match baseline, so a rollback to tick 0 has somewhere
    // to rewind to.
    this.history.set(-1, { state: game.serialize(), pending: [] })
    this.patch({ match, lobby: 'in-match', room: this.state.room })
    this.startClockSync()
  }

  /** Bookkeeping for a lock, on both the live path and replays. */
  private onLocked(): void {
    const match = this.state.match
    if (!match) return
    match.lockCount += 1
    this.lockedThisTick = true
    if (!this.replaying) this.notify()
  }

  /** Move a clamped input from the tick we predicted to the one the server used. */
  private rescheduleClamped(ack: ActionAckPayload): void {
    for (const [tick, queued] of this.inputs) {
      const index = queued.findIndex((input) => input.seq === ack.seq)
      if (index < 0) continue
      const [input] = queued.splice(index, 1)
      if (queued.length === 0) this.inputs.delete(tick)
      this.schedule(ack.appliedTick, input)
      return
    }
  }

  /** Queue an input on a tick, keeping each tick's inputs in sequence order. */
  private schedule(tick: number, input: ScheduledInput): void {
    const existing = this.inputs.get(tick)
    if (!existing) {
      this.inputs.set(tick, [input])
      return
    }
    existing.push(input)
    existing.sort((a, b) => a.seq - b.seq)
  }

  /**
   * One tick of local simulation — deliberately the mirror image of the
   * server's `stepPlayer`.
   *
   * The two must stay identical step for step: same order (inputs, advance,
   * garbage), same fixed `TICK_MS`, same rule for when garbage may enter the
   * well. That symmetry is what makes prediction correct rather than merely
   * close, so a change here without the matching change on the server
   * reintroduces exactly the drift this design removes.
   */
  private stepTick(tick: number): void {
    const match = this.state.match
    const game = match?.localGame
    if (!match || !game) return
    match.tick = tick

    if (game.gameOver) {
      this.history.set(tick, { state: game.serialize(), pending: this.clonePending() })
      return
    }

    for (const input of this.inputs.get(tick) ?? []) {
      game.action(input.action as Action)
    }

    const due = this.garbage.get(tick)
    if (due?.length) this.pendingGarbage.push(...due)

    this.lockedThisTick = false
    game.advance(match.tickMs)

    // Garbage waits for a lock rather than dropping in mid-piece (AC-03). With a
    // shared timeline "the first lock at or after tick N" is the same event in
    // both simulations — back when each side counted locks in its own private
    // game, it was not.
    if (this.pendingGarbage.length > 0 && (this.lockedThisTick || !game.activePiece)) {
      const rows = this.pendingGarbage
      this.pendingGarbage = []
      game.receiveGarbage(rows)
    }

    this.history.set(tick, { state: game.serialize(), pending: this.clonePending() })
    this.prune(tick - HISTORY_TICKS)
  }

  /**
   * Rewind to just before `fromTick` and re-simulate to the present.
   *
   * Presentation hooks are muted for the replayed range — those locks, clears
   * and level-ups already played once, and re-firing them would stack duplicate
   * sound effects and particles on every correction. The lock hook stays live
   * because garbage timing depends on it.
   */
  private rollbackTo(fromTick: number): boolean {
    const match = this.state.match
    const game = match?.localGame
    if (!match || !game) return false
    const prior = this.history.get(fromTick - 1)
    if (!prior) return false

    const resumeAt = match.tick
    game.restore(prior.state)
    this.pendingGarbage = [...prior.pending]

    this.replaying = true
    try {
      game.replay(
        () => {
          for (let tick = fromTick; tick <= resumeAt; tick++) this.stepTick(tick)
        },
        { onLock: () => this.onLocked() }
      )
    } finally {
      this.replaying = false
    }
    return true
  }

  /** Snapshot the pending queue. Rows are never mutated, so the array copy suffices. */
  private clonePending(): GarbageRow[] {
    return [...this.pendingGarbage]
  }

  private prune(below: number): void {
    for (const tick of this.history.keys()) if (tick < below) this.history.delete(tick)
    for (const tick of this.inputs.keys()) if (tick < below) this.inputs.delete(tick)
    for (const tick of this.garbage.keys()) if (tick < below) this.garbage.delete(tick)
  }

  // --- Clock sync ------------------------------------------------------------

  /**
   * Estimate the offset between this machine's clock and the server's, so a
   * locally chosen tick number means the same instant on both sides.
   *
   * Keeps the sample with the lowest round trip rather than averaging: the
   * fastest probe is the one least distorted by queueing, so it carries the
   * least uncertainty about where the midpoint actually was.
   */
  private startClockSync(): void {
    this.stopClockSync()
    this.sendPing()
    this.pingTimer = setInterval(() => this.sendPing(), CLOCK_SYNC_INTERVAL_MS)
  }

  private stopClockSync(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private sendPing(): void {
    if (!this.socket?.connected) return
    const payload: PingPayload = { clientTime: Math.floor(this.now()) }
    this.emit(ClientEvent.Ping, payload)
  }

  private applyPong(pong: PongPayload): void {
    const now = this.now()
    const rtt = now - pong.clientTime
    if (rtt < 0) return

    // The authoritative tick anchor is re-taken on every valid sample, not only
    // on the best one: it tracks a moving quantity (where the server's loop
    // actually got to), and a stale anchor is precisely the failure being
    // avoided. The wall-clock offset below is a static property of the two
    // clocks, so that one does keep its best estimate.
    const match = this.state.match
    if (pong.serverTick !== null && match) {
      // The tick was sampled one return leg ago, so the server has advanced by
      // roughly half a round trip since.
      const inFlightTicks = Math.round(rtt / 2 / match.tickMs)
      this.anchor = { serverTick: pong.serverTick + inFlightTicks, atLocalMs: now }
    }

    if (rtt >= this.bestRtt) return
    this.bestRtt = rtt
    // Server time at the moment we receive this ≈ its send time plus the
    // return leg; the offset turns our clock into its clock.
    this.clockOffsetMs = pong.serverTime + rtt / 2 - now
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

  /**
   * Book a delivery onto the tick the server scheduled it for. Uses the wire
   * hole list — never regenerates holes from local RNG.
   *
   * Normally the tick is still in the future and this is pure bookkeeping. If
   * the delivery arrives late, the rows belong to a tick already simulated, so
   * the local timeline is rewound and replayed with them included.
   */
  private queueGarbage(payload: GarbageDeliveryPayload): void {
    const match = this.state.match
    const me = this.state.user?.id
    if (!match || !me) return
    if (payload.roomId !== match.roomId) return
    if (payload.toUserId !== me) return

    const at = payload.applyAtTick
    this.garbage.set(at, [...(this.garbage.get(at) ?? []), ...payload.rows])
    if (at <= match.tick) this.rollbackTo(at)
    this.notify()
  }

  /**
   * Accept the server's version of our own board and rebuild the present on top
   * of it.
   *
   * Almost always a no-op: prediction and authority agree, so the correction
   * matches what we already had and is dropped without touching the screen. The
   * rest of the time this is the only thing standing between a small divergence
   * and the permanent one where each player watches a different game.
   */
  private applyCorrection(payload: StateCorrectionPayload): void {
    const match = this.state.match
    const game = match?.localGame
    const me = this.state.user?.id
    if (!match || !game) return
    if (payload.roomId !== match.roomId) return
    if (me && payload.userId !== me) return

    const mine = this.history.get(payload.tick)
    if (mine && statesAgree(mine.state, payload.state as unknown as GameState)) return

    const authoritative = payload.state as unknown as GameState
    // The queue of garbage owed but not yet inserted comes from the server too.
    // It cannot be read off the board — that shows rows already applied, never
    // rows still waiting for a lock — so a client that guessed it would drop
    // rows it had been sent, and diverge again at the very next lock.
    //
    // A payload without the field is wire data from an older peer, not a
    // statement that nothing is pending: fall back to the local prediction for
    // that tick. Clearing the queue here is the one thing that must not happen.
    const authoritativePending = payload.pending
      ? payload.pending.map((row) => ({ hole: row.hole }))
      : [...(mine?.pending ?? this.pendingGarbage)]
    this.history.set(payload.tick, { state: authoritative, pending: authoritativePending })

    if (payload.tick >= match.tick) {
      // The server is ahead of us — adopt its state wholesale and resume there.
      game.restore(authoritative)
      match.tick = payload.tick
      this.pendingGarbage = [...authoritativePending]
    } else if (!this.rollbackTo(payload.tick + 1)) {
      // Too old to replay from; take the state as-is rather than keep a board
      // we already know is wrong.
      game.restore(authoritative)
      match.tick = payload.tick
      this.pendingGarbage = [...authoritativePending]
    }
    this.notify()
  }

  private clearMatchInternal(): void {
    this.stopClockSync()
    this.pendingGarbage = []
    this.inputs.clear()
    this.garbage.clear()
    this.history.clear()
    this.bestRtt = Number.POSITIVE_INFINITY
    this.clockOffsetMs = 0
    this.anchor = null
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
