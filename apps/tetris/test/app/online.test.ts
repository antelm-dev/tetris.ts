import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Game, mulberry32 } from '@tetris/engine'
import {
  ClientEvent,
  OnlineClient,
  PROTOCOL_VERSION,
  ServerEvent,
  type AuthResult,
  type OnlineSocket,
  type OnlineSocketFactory
} from '@tetris/renderer/app/online'

/** In-memory socket that records emits and lets tests push server envelopes. */
class FakeSocket implements OnlineSocket {
  connected = true
  /** When false, Authenticate does not auto-reply with Connected. */
  autoAuth = true
  readonly emitted: Array<{ event: string; args: unknown[] }> = []
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(listener)
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(listener)
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args })
    if (event === ClientEvent.Authenticate && this.autoAuth) {
      queueMicrotask(() => {
        this.push(ServerEvent.Connected, envelope(0, { userId: 'user-1', sessionId: 'sess-1' }))
      })
    }
  }

  disconnect(): void {
    this.connected = false
    this.dispatch('disconnect')
  }

  push(event: string, payload: unknown): void {
    this.dispatch(event, payload)
  }

  private dispatch(event: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...args)
  }
}

let envelopeSeq = 0
function envelope(seq: number, data: unknown) {
  return { protocolVersion: PROTOCOL_VERSION, seq, ts: 1_000 + seq, data }
}

function nextEnvelope(data: unknown) {
  return envelope(++envelopeSeq, data)
}

const AUTH: AuthResult = {
  user: { id: 'user-1', email: 'a@b.co', displayName: 'Ada' },
  tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 }
}

function mockFetchOk() {
  return vi.fn(async () => {
    return new Response(JSON.stringify(AUTH), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  })
}

function roomState(partial: Record<string, unknown> = {}) {
  return {
    roomId: 'room-1',
    name: 'Test',
    hostUserId: 'user-1',
    maxPlayers: 2,
    players: [
      { userId: 'user-1', displayName: 'Ada', ready: false, connected: true },
      { userId: 'user-2', displayName: 'Bob', ready: false, connected: true }
    ],
    status: 'lobby',
    ...partial
  }
}

function boardOccupiedCount(game: Game): number {
  return game.project().board.reduce((sum, row) => sum + row.filter((c) => c !== 0).length, 0)
}

/** Milliseconds per tick — matches the protocol's shared clock. */
const TICK = 16

/** A match that starts at epoch 0, so `pump(TICK * n)` lands exactly on tick n. */
function gameStarted(partial: Record<string, unknown> = {}) {
  return {
    roomId: 'room-1',
    seed: 1,
    startedAt: 0,
    tickMs: TICK,
    rollbackWindowTicks: 8,
    ...partial
  }
}

function delivery(partial: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    deliverySeq: 1,
    fromUserId: 'user-2',
    toUserId: 'user-1',
    rows: [{ hole: 1 }],
    applyAtTick: 2,
    ...partial
  }
}

describe('OnlineClient', () => {
  let socket: FakeSocket
  let createSocket: OnlineSocketFactory
  let client: OnlineClient
  let now: number

  beforeEach(async () => {
    envelopeSeq = 0
    now = 5_000
    socket = new FakeSocket()
    createSocket = vi.fn(() => socket)
    client = new OnlineClient({
      apiOrigin: 'http://api.test',
      fetch: mockFetchOk(),
      createSocket,
      now: () => now
    })
    await client.login({ email: 'a@b.co', password: 'secret' })
  })

  it('registers/logs in against /api/auth and keeps tokens only in memory', async () => {
    const fetchFn = mockFetchOk()
    const c = new OnlineClient({ apiOrigin: 'http://api.test', fetch: fetchFn, createSocket })
    const result = await c.register({
      email: 'a@b.co',
      displayName: 'Ada',
      password: 'secret'
    })
    expect(result.user.id).toBe('user-1')
    expect(fetchFn).toHaveBeenCalledWith(
      'http://api.test/api/auth/register',
      expect.objectContaining({ method: 'POST' })
    )
    expect(c.getState().user).toEqual(AUTH.user)
    // No persistence API — tokens are not exposed on public state.
    expect(c.getState()).not.toHaveProperty('tokens')
  })

  it('connects /game, authenticates with PROTOCOL_VERSION, and exposes ready state', async () => {
    await client.connect()
    expect(createSocket).toHaveBeenCalledWith('http://api.test/game')
    expect(client.getState().connection).toBe('ready')
    expect(client.getState().sessionId).toBe('sess-1')
    expect(socket.emitted[0]?.event).toBe(ClientEvent.Authenticate)
    const authPayload = socket.emitted[0]?.args[0] as { protocolVersion: number; token: string }
    expect(authPayload.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(authPayload.token).toBeTruthy()
  })

  it('tears down the previous socket on a second connect()', async () => {
    const sockets: FakeSocket[] = []
    const factory = vi.fn(() => {
      const s = new FakeSocket()
      s.autoAuth = false
      sockets.push(s)
      return s
    })
    const c = new OnlineClient({
      apiOrigin: 'http://api.test',
      fetch: mockFetchOk(),
      createSocket: factory,
      now: () => now
    })
    await c.login({ email: 'a@b.co', password: 'secret' })

    const firstConnect = c.connect()
    expect(sockets).toHaveLength(1)
    const first = sockets[0]!
    const disconnectSpy = vi.spyOn(first, 'disconnect')
    const offSpy = vi.spyOn(first, 'off')

    const secondConnect = c.connect()
    expect(disconnectSpy).toHaveBeenCalled()
    expect(offSpy.mock.calls.length).toBeGreaterThan(0)
    expect(first.connected).toBe(false)
    expect(sockets).toHaveLength(2)

    const second = sockets[1]!
    second.push(ServerEvent.Connected, envelope(0, { userId: 'user-1', sessionId: 'sess-2' }))
    await secondConnect
    expect(c.getState().connection).toBe('ready')
    expect(c.getState().sessionId).toBe('sess-2')
    // First connect promise should also settle once the replacement is ready.
    await firstConnect
  })

  it('tracks lobby create/join/ready/start without leaking the socket', async () => {
    await client.connect()
    client.createRoom({ name: 'Test', maxPlayers: 2, isPrivate: true })
    expect(socket.emitted.at(-1)).toEqual({
      event: ClientEvent.RoomCreate,
      args: [{ name: 'Test', maxPlayers: 2, isPrivate: true }]
    })

    socket.push(ServerEvent.RoomCreated, nextEnvelope(roomState()))
    expect(client.getState().lobby).toBe('in-room')
    expect(client.room?.roomId).toBe('room-1')

    client.setReady(true)
    expect(socket.emitted.at(-1)?.event).toBe(ClientEvent.PlayerReady)

    socket.push(
      ServerEvent.RoomState,
      nextEnvelope(
        roomState({
          players: [
            { userId: 'user-1', displayName: 'Ada', ready: true, connected: true },
            { userId: 'user-2', displayName: 'Bob', ready: true, connected: true }
          ]
        })
      )
    )
    client.startGame()
    expect(socket.emitted.at(-1)?.event).toBe(ClientEvent.GameStart)
    expect(client.getState()).not.toHaveProperty('socket')
  })

  it('starts a seeded local Game and sequences player actions', async () => {
    await client.connect()
    socket.push(ServerEvent.RoomCreated, nextEnvelope(roomState()))

    socket.push(ServerEvent.GameStarted, nextEnvelope({ roomId: 'room-1', seed: 42, startedAt: 9_000 }))

    expect(client.getState().lobby).toBe('in-match')
    expect(client.match?.seed).toBe(42)
    expect(client.localGame).toBeInstanceOf(Game)

    const reference = new Game({ width: 10, height: 20, random: mulberry32(42) })
    reference.start()
    expect(client.localGame!.activePiece?.name).toBe(reference.activePiece?.name)
    expect(client.localGame!.nextPieces.map((p) => p.name)).toEqual(reference.nextPieces.map((p) => p.name))

    client.sendAction('left')
    client.sendAction('rotate-right')
    const actions = socket.emitted.filter((e) => e.event === ClientEvent.PlayerAction)
    expect(actions).toHaveLength(2)
    expect(actions[0].args[0]).toMatchObject({ roomId: 'room-1', seq: 0, ts: 5_000, action: 'left' })
    expect(actions[1].args[0]).toMatchObject({ seq: 1, action: 'rotate-right' })
    expect(client.match?.nextActionSeq).toBe(2)

    socket.push(
      ServerEvent.ActionAcknowledged,
      nextEnvelope({ schemaVersion: 1, roomId: 'room-1', seq: 0, action: 'left' })
    )
    expect(client.match?.lastAckedSeq).toBe(0)

    // pause is a full no-op online — neither emit nor local pause
    const before = socket.emitted.length
    expect(client.localGame!.paused).toBe(false)
    client.sendAction('pause')
    expect(socket.emitted.length).toBe(before)
    expect(client.localGame!.paused).toBe(false)
  })

  it('drops stale opponent snapshot sequences and keeps display-only remote state', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope({ roomId: 'room-1', seed: 1, startedAt: 1 }))

    const board = Array.from({ length: 20 }, () => Array(10).fill(0))
    const snap = (seq: number, score: number) => ({
      schemaVersion: 1,
      roomId: 'room-1',
      userId: 'user-2',
      seq,
      score,
      lines: 0,
      level: 1,
      board,
      gameOver: false
    })

    socket.push(ServerEvent.Snapshot, nextEnvelope(snap(2, 100)))
    expect(client.remoteProjection?.seq).toBe(2)
    expect(client.remoteProjection?.score).toBe(100)

    socket.push(ServerEvent.Snapshot, nextEnvelope(snap(1, 50)))
    expect(client.remoteProjection?.seq).toBe(2)
    expect(client.remoteProjection?.score).toBe(100)

    socket.push(ServerEvent.Snapshot, nextEnvelope(snap(3, 150)))
    expect(client.remoteProjection?.seq).toBe(3)
    expect(client.remoteProjection?.score).toBe(150)

    // Own-user snapshots are ignored (display is local prediction).
    socket.push(ServerEvent.Snapshot, nextEnvelope({ ...snap(9, 999), userId: 'user-1' }))
    expect(client.remoteProjection?.userId).toBe('user-2')
  })

  it('holds garbage scheduled for a tick until that tick reaches a lock', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 7 })))

    const received: unknown[] = []
    const game = client.localGame!
    const original = game.receiveGarbage.bind(game)
    game.receiveGarbage = (rows) => {
      received.push(rows)
      original(rows)
    }

    socket.push(
      ServerEvent.GarbageDelivered,
      nextEnvelope(delivery({ rows: [{ hole: 3 }, { hole: 4 }], applyAtTick: 2 }))
    )

    // Tick 2 arrives, but no piece has locked — rows must not shove an active
    // piece into the stack.
    client.pump(TICK * 3)
    expect(received).toEqual([])
    expect(game.activePiece).toBeTruthy()

    // Hard drop on tick 3 locks the piece, which is when the rows may enter.
    client.sendAction('push')
    client.pump(TICK * 4)
    expect(received).toEqual([[{ hole: 3 }, { hole: 4 }]])
  })

  it('rewinds and replays when a delivery arrives for a tick already simulated', async () => {
    // Reference client: the same delivery, received before its tick.
    const onTimeSocket = new FakeSocket()
    const onTime = new OnlineClient({
      apiOrigin: 'http://api.test',
      fetch: mockFetchOk(),
      createSocket: () => onTimeSocket,
      now: () => now
    })
    await onTime.login({ email: 'a@b.co', password: 'secret' })
    await onTime.connect()
    onTimeSocket.push(ServerEvent.GameStarted, envelope(1, gameStarted({ seed: 31 })))
    onTimeSocket.push(ServerEvent.GarbageDelivered, envelope(2, delivery({ rows: [{ hole: 6 }], applyAtTick: 4 })))
    onTime.sendAction('push')
    for (let tick = 1; tick <= 12; tick++) onTime.pump(TICK * tick)

    // Late client: identical inputs, but the delivery shows up eight ticks late.
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 31 })))
    client.sendAction('push')
    for (let tick = 1; tick <= 12; tick++) client.pump(TICK * tick)
    socket.push(ServerEvent.GarbageDelivered, nextEnvelope(delivery({ rows: [{ hole: 6 }], applyAtTick: 4 })))

    expect(client.match?.tick).toBe(onTime.match?.tick)
    expect(client.localGame!.serialize()).toEqual(onTime.localGame!.serialize())
    expect(boardOccupiedCount(client.localGame!)).toBeGreaterThan(0)

    onTime.dispose()
  })

  it('adopts an authoritative correction that disagrees with local prediction', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 5 })))
    for (let tick = 1; tick <= 10; tick++) client.pump(TICK * tick)

    const game = client.localGame!
    const drifted = game.serialize()
    drifted.score = 4242

    socket.push(
      ServerEvent.StateCorrection,
      nextEnvelope({
        schemaVersion: 1,
        roomId: 'room-1',
        userId: 'user-1',
        tick: 6,
        state: drifted,
        reason: 'baseline'
      })
    )

    expect(game.score).toBe(4242)
    // Replayed forward to where we were, not left stranded at the corrected tick.
    expect(client.match?.tick).toBe(10)
  })

  it('adopts corrections that differ only in hidden future-affecting engine state', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 5 })))
    for (let tick = 1; tick <= 10; tick++) client.pump(TICK * tick)

    const game = client.localGame!
    const authoritative = game.serialize()
    authoritative.lastActionRotate = !authoritative.lastActionRotate

    socket.push(
      ServerEvent.StateCorrection,
      nextEnvelope({
        schemaVersion: 1,
        roomId: 'room-1',
        userId: 'user-1',
        tick: client.match!.tick,
        state: authoritative,
        reason: 'baseline'
      })
    )

    expect(game.serialize().lastActionRotate).toBe(authoritative.lastActionRotate)
  })

  it('uses pong serverTick to avoid running far ahead after the server drops stalled time', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 17 })))

    // A valid lagged-server sample: wall time advanced by 100 ticks, but the
    // authoritative loop dropped the stall and has only simulated tick 0.
    now = TICK * 100
    socket.push(ServerEvent.Pong, nextEnvelope({ clientTime: now, serverTime: now, serverTick: 0 }))

    for (let frame = 0; frame < 20; frame++) client.pump(now)

    expect(client.match?.tick).toBeLessThanOrEqual(1)
  })

  it('keeps garbage that is due but waiting for a lock across a correction', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 23 })))

    // Rows come due at tick 2 but no piece has locked, so they sit in the queue
    // — invisible on the board, and unreconstructable from engine state alone.
    socket.push(ServerEvent.GarbageDelivered, nextEnvelope(delivery({ rows: [{ hole: 8 }], applyAtTick: 2 })))
    for (let tick = 1; tick <= 5; tick++) client.pump(TICK * tick)

    const game = client.localGame!
    const received: unknown[] = []
    const original = game.receiveGarbage.bind(game)
    game.receiveGarbage = (rows) => {
      received.push(rows)
      original(rows)
    }

    // A correction arrives carrying the server's own view of that queue.
    const authoritative = game.serialize()
    authoritative.score += 10
    socket.push(
      ServerEvent.StateCorrection,
      nextEnvelope({
        schemaVersion: 1,
        roomId: 'room-1',
        userId: 'user-1',
        tick: 4,
        state: authoritative,
        pending: [{ hole: 8 }],
        reason: 'baseline'
      })
    )

    // The rows must still land at the next lock rather than vanish.
    client.sendAction('push')
    client.pump(TICK * 7)
    expect(received).toEqual([[{ hole: 8 }]])
  })

  it('keeps a wireLocalEvents onLock composed with the client bookkeeping', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope(gameStarted({ seed: 9 })))

    const extraLocks: boolean[] = []
    client.wireLocalEvents({
      onLock: (hard) => {
        extraLocks.push(hard)
      }
    })

    client.sendAction('push')
    client.pump(TICK * 2)

    expect(extraLocks).toEqual([true])
    expect(client.match?.lockCount).toBe(1)
  })

  it('clears match state on game-over and dispose tears down the socket', async () => {
    await client.connect()
    socket.push(ServerEvent.RoomCreated, nextEnvelope(roomState()))
    socket.push(ServerEvent.GameStarted, nextEnvelope({ roomId: 'room-1', seed: 3, startedAt: 1 }))
    expect(client.localGame).toBeTruthy()

    socket.push(
      ServerEvent.GameOver,
      nextEnvelope({
        schemaVersion: 1,
        roomId: 'room-1',
        standings: [
          { userId: 'user-1', place: 1, score: 10, lines: 1 },
          { userId: 'user-2', place: 2, score: 0, lines: 0 }
        ],
        endedAt: 99
      })
    )
    expect(client.getState().lobby).toBe('finished')
    expect(client.match?.gameOver?.standings[0].place).toBe(1)

    client.clearMatch()
    expect(client.match).toBeNull()
    expect(client.getState().lobby).toBe('in-room')

    const offSpy = vi.spyOn(socket, 'off')
    client.dispose()
    expect(socket.connected).toBe(false)
    expect(offSpy.mock.calls.length).toBeGreaterThan(0)
    expect(client.getState().connection).toBe('idle')
    expect(client.user).toBeNull()
  })

  it('keeps the shared mulberry32 player-bag contract with a given seed', () => {
    const seed = 123456
    const a = new Game({ width: 10, height: 20, random: mulberry32(seed) })
    const b = new Game({ width: 10, height: 20, random: mulberry32(seed) })
    a.start()
    b.start()
    const namesA = [a.activePiece!.name, ...a.nextPieces.map((p) => p.name)]
    const namesB = [b.activePiece!.name, ...b.nextPieces.map((p) => p.name)]
    expect(namesA).toEqual(namesB)

    for (let i = 0; i < 14; i++) {
      a.action('push')
      b.action('push')
    }
    expect(a.activePiece?.name).toBe(b.activePiece?.name)
    expect(a.nextPieces.map((p) => p.name)).toEqual(b.nextPieces.map((p) => p.name))
  })
})
