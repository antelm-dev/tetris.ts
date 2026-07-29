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
    socket.on('connect', () => {
      socket.emit(ClientEvent.Authenticate, { protocolVersion: PROTOCOL_VERSION, token })
    })
    socket.on(ServerEvent.Connected, () => resolve(socket))
    socket.on(ServerEvent.Error, (err) => reject(new Error(JSON.stringify(err))))
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
})
