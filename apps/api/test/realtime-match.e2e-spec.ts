import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { IoAdapter } from '@nestjs/platform-socket.io'
import {
  ClientEvent,
  PROTOCOL_VERSION,
  ServerEvent,
  type GameStartedPayload,
  type ServerEnvelope,
  type SnapshotPayload
} from '@tetris/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module'
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter'
import { GamesService } from '../src/games/games.service'

type Envelope<T> = ServerEnvelope<T>

async function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<Envelope<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs)
    socket.once(event, (payload: Envelope<T>) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

async function waitForRoomReady(socket: Socket, roomId: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for both players ready')), timeoutMs)
    const onState = (envelope: Envelope<{ roomId: string; players: Array<{ ready: boolean }> }>) => {
      const state = envelope.data
      if (state.roomId !== roomId) return
      if (state.players.length === 2 && state.players.every((p) => p.ready)) {
        clearTimeout(timer)
        socket.off(ServerEvent.RoomState, onState)
        resolve()
      }
    }
    socket.on(ServerEvent.RoomState, onState)
  })
}

async function register(app: NestFastifyApplication, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, displayName: email.split('@')[0], password: 'password123' }
  })
  expect(res.statusCode).toBe(201)
  const body = res.json() as { tokens: { accessToken: string } }
  expect(body.tokens.accessToken).toBeTruthy()
  return body.tokens.accessToken
}

function connectGame(port: number, token: string): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${port}/game`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  })
  return new Promise((resolve, reject) => {
    const onAuthError = (err: unknown) => reject(new Error(JSON.stringify(err)))
    socket.on('connect', () => {
      socket.emit(ClientEvent.Authenticate, { protocolVersion: PROTOCOL_VERSION, token })
    })
    socket.on(ServerEvent.Connected, () => {
      socket.off(ServerEvent.Error, onAuthError)
      resolve(socket)
    })
    socket.on(ServerEvent.Error, onAuthError)
    socket.on('connect_error', reject)
  })
}

describe('Realtime match (e2e)', () => {
  let app: NestFastifyApplication
  let port: number
  let games: GamesService

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false })
    app.useWebSocketAdapter(new IoAdapter(app))
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.getHttpServer().address()
    port = typeof address === 'object' && address ? address.port : 0
    games = app.get(GamesService)
  }, 30_000)

  afterAll(async () => {
    games?.onModuleDestroy()
    await app?.close()
  })

  it('runs lobby-to-start and acknowledges only the owner action', async () => {
    const tokenA = await register(app, `a-${Date.now()}@example.com`)
    const tokenB = await register(app, `b-${Date.now()}@example.com`)
    const a = await connectGame(port, tokenA)
    const b = await connectGame(port, tokenB)

    const created = waitForEvent(a, ServerEvent.RoomCreated)
    a.emit(ClientEvent.RoomCreate, { name: 'vs', maxPlayers: 2 })
    const room = (await created).data as { roomId: string }
    const roomId = room.roomId

    const joined = waitForEvent(b, ServerEvent.RoomJoined)
    b.emit(ClientEvent.RoomJoin, { roomId })
    await joined

    const readyWait = waitForRoomReady(a, roomId)
    a.emit(ClientEvent.PlayerReady, { roomId, ready: true })
    b.emit(ClientEvent.PlayerReady, { roomId, ready: true })
    await readyWait

    const startedA = waitForEvent<GameStartedPayload>(a, ServerEvent.GameStarted)
    const startedB = waitForEvent<GameStartedPayload>(b, ServerEvent.GameStarted)
    const startError = waitForEvent(a, ServerEvent.Error).then((err) => {
      throw new Error(`GameStart error: ${JSON.stringify(err.data)}`)
    })
    a.emit(ClientEvent.GameStart, { roomId })
    const [startA, startB] = await Promise.race([
      Promise.all([startedA, startedB]),
      startError.then(() => {
        throw new Error('unreachable')
      })
    ])
    expect(startA.data.seed).toBe(startB.data.seed)
    expect(startA.data.startedAt).toBe(startB.data.startedAt)

    const snapB = waitForEvent<SnapshotPayload>(b, ServerEvent.Snapshot)
    const snapshot = await snapB
    expect(snapshot.seq).toBeGreaterThanOrEqual(0)
    expect(snapshot.data.board).toBeDefined()
    expect(snapshot.data.board.length).toBeGreaterThan(0)
    expect(snapshot.data.userId).toBeTruthy()

    const ack = waitForEvent(a, ServerEvent.ActionAcknowledged)
    a.emit(ClientEvent.PlayerAction, { roomId, seq: 1, ts: Date.now(), action: 'left' })
    const ackPayload = await ack
    expect((ackPayload.data as { seq: number }).seq).toBe(1)

    // Duplicate seq must not produce another ack.
    let duplicateAck = false
    a.once(ServerEvent.ActionAcknowledged, () => {
      duplicateAck = true
    })
    a.emit(ClientEvent.PlayerAction, { roomId, seq: 1, ts: Date.now(), action: 'right' })
    await new Promise((r) => setTimeout(r, 50))
    expect(duplicateAck).toBe(false)

    // Wrong-room action ignored.
    b.emit(ClientEvent.PlayerAction, { roomId: 'nope', seq: 1, ts: Date.now(), action: 'left' })
    await new Promise((r) => setTimeout(r, 50))

    expect(games.hasActiveMatch(roomId)).toBe(true)

    const left = waitForEvent(a, ServerEvent.RoomLeft)
    a.emit(ClientEvent.RoomLeave, { roomId })
    await left
    expect(games.hasActiveMatch(roomId)).toBe(false)

    a.close()
    b.close()
  }, 20_000)

  it('rejects an action for a room other than the socket current room', async () => {
    const stamp = Date.now()
    const tokenA = await register(app, `cross-a-${stamp}@example.com`)
    const tokenB = await register(app, `cross-b-${stamp}@example.com`)
    const tokenC = await register(app, `cross-c-${stamp}@example.com`)
    const a = await connectGame(port, tokenA)
    const b = await connectGame(port, tokenB)
    const c = await connectGame(port, tokenC)

    try {
      const createdOne = waitForEvent<{ roomId: string }>(a, ServerEvent.RoomCreated)
      a.emit(ClientEvent.RoomCreate, { name: 'first', maxPlayers: 2 })
      const roomOne = (await createdOne).data.roomId

      const joinedOne = waitForEvent(b, ServerEvent.RoomJoined)
      b.emit(ClientEvent.RoomJoin, { roomId: roomOne })
      await joinedOne

      const createdTwo = waitForEvent<{ roomId: string }>(c, ServerEvent.RoomCreated)
      c.emit(ClientEvent.RoomCreate, { name: 'second', maxPlayers: 2 })
      const roomTwo = (await createdTwo).data.roomId

      // One-room-per-socket: joining a second room while still in the first is rejected.
      const joinError = waitForEvent<{ code: string }>(a, ServerEvent.Error)
      a.emit(ClientEvent.RoomJoin, { roomId: roomTwo })
      const rejected = await joinError
      expect(rejected.data.code).toBe('ALREADY_IN_ROOM')

      const ready = waitForRoomReady(a, roomOne)
      a.emit(ClientEvent.PlayerReady, { roomId: roomOne, ready: true })
      b.emit(ClientEvent.PlayerReady, { roomId: roomOne, ready: true })
      await ready

      const started = waitForEvent(a, ServerEvent.GameStarted)
      a.emit(ClientEvent.GameStart, { roomId: roomOne })
      await started

      // Payload room must equal the socket current room — roomTwo must never ack.
      let acknowledged = false
      a.once(ServerEvent.ActionAcknowledged, () => {
        acknowledged = true
      })
      a.emit(ClientEvent.PlayerAction, { roomId: roomTwo, seq: 1, ts: Date.now(), action: 'left' })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(acknowledged).toBe(false)

      // Control stays with the current room only.
      const ack = waitForEvent(a, ServerEvent.ActionAcknowledged)
      a.emit(ClientEvent.PlayerAction, { roomId: roomOne, seq: 1, ts: Date.now(), action: 'left' })
      await ack
    } finally {
      a.close()
      b.close()
      c.close()
    }
  }, 20_000)

  it('does not let a non-member leave and terminate an active match', async () => {
    const stamp = Date.now()
    const tokenA = await register(app, `leave-a-${stamp}@example.com`)
    const tokenB = await register(app, `leave-b-${stamp}@example.com`)
    const tokenC = await register(app, `leave-c-${stamp}@example.com`)
    const a = await connectGame(port, tokenA)
    const b = await connectGame(port, tokenB)
    const c = await connectGame(port, tokenC)

    try {
      const created = waitForEvent<{ roomId: string }>(a, ServerEvent.RoomCreated)
      a.emit(ClientEvent.RoomCreate, { name: 'protected', maxPlayers: 2 })
      const roomId = (await created).data.roomId

      const joined = waitForEvent(b, ServerEvent.RoomJoined)
      b.emit(ClientEvent.RoomJoin, { roomId })
      await joined

      const ready = waitForRoomReady(a, roomId)
      a.emit(ClientEvent.PlayerReady, { roomId, ready: true })
      b.emit(ClientEvent.PlayerReady, { roomId, ready: true })
      await ready

      const started = waitForEvent(a, ServerEvent.GameStarted)
      a.emit(ClientEvent.GameStart, { roomId })
      await started
      expect(games.hasActiveMatch(roomId)).toBe(true)

      c.emit(ClientEvent.RoomLeave, { roomId })
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(games.hasActiveMatch(roomId)).toBe(true)
    } finally {
      a.close()
      b.close()
      c.close()
    }
  }, 20_000)
})
