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
    if (event === ClientEvent.Authenticate) {
      const payload = args[0] as { protocolVersion: number; token: string }
      expect(payload.protocolVersion).toBe(PROTOCOL_VERSION)
      expect(payload.token).toBeTruthy()
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

    // pause stays local — server rejects it
    const before = socket.emitted.length
    client.sendAction('pause')
    expect(socket.emitted.length).toBe(before)
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

  it('applies GarbageDelivered holes only at the appliedAtLock boundary', async () => {
    await client.connect()
    socket.push(ServerEvent.GameStarted, nextEnvelope({ roomId: 'room-1', seed: 7, startedAt: 1 }))

    const received: unknown[] = []
    const game = client.localGame!
    const original = game.receiveGarbage.bind(game)
    game.receiveGarbage = (rows) => {
      received.push(rows)
      original(rows)
    }

    socket.push(
      ServerEvent.GarbageDelivered,
      nextEnvelope({
        schemaVersion: 1,
        roomId: 'room-1',
        deliverySeq: 1,
        fromUserId: 'user-2',
        toUserId: 'user-1',
        rows: [{ hole: 3 }, { hole: 4 }],
        appliedAtLock: 1
      })
    )
    expect(received).toEqual([])
    expect(client.match?.lockCount).toBe(0)

    // Simulate the lock boundary the server documents.
    game.events.onLock?.(false)
    expect(client.match?.lockCount).toBe(1)
    expect(received).toEqual([[{ hole: 3 }, { hole: 4 }]])
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
