import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import {
  ClientEvent,
  PROTOCOL_VERSION,
  ServerEvent,
  authenticatePayloadSchema,
  gameStartPayloadSchema,
  playerActionPayloadSchema,
  playerReadyPayloadSchema,
  roomCreatePayloadSchema,
  roomJoinPayloadSchema,
  roomLeavePayloadSchema
} from '@tetris/protocol'
import type { ServerEnvelope } from '@tetris/protocol'
import type { Server, Socket } from 'socket.io'
import type { ZodSchema } from 'zod'
import { TokenService } from '../auth/token.service'
import { RoomsService } from '../rooms/rooms.service'

/** Per-socket state we attach to `socket.data`. */
interface SocketState {
  userId?: string
  displayName?: string
  /** Server-assigned outbound sequence for this connection. */
  outSeq: number
}

type TypedSocket = Socket & { data: SocketState }

/**
 * Realtime gateway for gameplay, under the `/game` namespace (configurable via
 * `WS_NAMESPACE`). It serves both the web and Electron clients over the same
 * process as the REST API — one deployment, no separate realtime service.
 *
 * Design commitments encoded here:
 *  - every inbound payload is validated with the shared `@tetris/protocol` zod
 *    schemas before it touches domain code;
 *  - every outbound message is wrapped in a versioned {@link ServerEnvelope}
 *    with a per-connection sequence number;
 *  - actions carry client sequence numbers (`seq`) so the authoritative engine
 *    can order/deduplicate them.
 *
 * Not yet built (intentionally — this is the foundation): the fixed-timestep
 * simulation loop and snapshot broadcasting. When added, opponent snapshots
 * MUST be down-sampled to ~5–10 Hz — never the full 60 Hz board — and routed
 * through the {@link PubSub} bus so they survive a multi-instance deployment.
 */
@WebSocketGateway({
  namespace: process.env.WS_NAMESPACE ?? '/game',
  cors: { origin: true }
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name)

  @WebSocketServer()
  private server!: Server

  constructor(
    private readonly tokens: TokenService,
    private readonly rooms: RoomsService
  ) {}

  handleConnection(socket: TypedSocket): void {
    socket.data.outSeq = 0
    this.logger.debug(`Socket connected: ${socket.id} (awaiting authenticate)`)
  }

  handleDisconnect(socket: TypedSocket): void {
    this.logger.debug(`Socket disconnected: ${socket.id}`)
  }

  // --- Authentication --------------------------------------------------------

  @SubscribeMessage(ClientEvent.Authenticate)
  async authenticate(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): Promise<void> {
    const payload = this.validate(socket, ClientEvent.Authenticate, authenticatePayloadSchema, body)
    if (!payload) return

    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      this.error(socket, ClientEvent.Authenticate, 'PROTOCOL_MISMATCH', `Expected protocol v${PROTOCOL_VERSION}`)
      socket.disconnect(true)
      return
    }

    const claims = await this.tokens.verifyAccess(payload.token)
    if (!claims) {
      this.error(socket, ClientEvent.Authenticate, 'UNAUTHENTICATED', 'Invalid or expired token')
      socket.disconnect(true)
      return
    }

    socket.data.userId = claims.sub
    socket.data.displayName = claims.email
    this.send(socket, ServerEvent.Connected, { userId: claims.sub, sessionId: socket.id })
  }

  // --- Rooms -----------------------------------------------------------------

  @SubscribeMessage(ClientEvent.RoomCreate)
  roomCreate(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.RoomCreate, roomCreatePayloadSchema, body)
    if (!payload) return

    const room = this.rooms.create({
      name: payload.name,
      hostUserId: user.userId,
      hostDisplayName: user.displayName,
      maxPlayers: payload.maxPlayers,
      isPrivate: payload.isPrivate
    })
    void socket.join(room.id)
    this.send(socket, ServerEvent.RoomCreated, this.rooms.toState(room))
    this.broadcastRoomState(room.id)
  }

  @SubscribeMessage(ClientEvent.RoomJoin)
  roomJoin(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.RoomJoin, roomJoinPayloadSchema, body)
    if (!payload) return

    const room = this.rooms.join(payload.roomId, user.userId, user.displayName)
    void socket.join(room.id)
    this.send(socket, ServerEvent.RoomJoined, this.rooms.toState(room))
    this.broadcastRoomState(room.id)
  }

  @SubscribeMessage(ClientEvent.RoomLeave)
  roomLeave(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.RoomLeave, roomLeavePayloadSchema, body)
    if (!payload) return

    const room = this.rooms.leave(payload.roomId, user.userId)
    void socket.leave(payload.roomId)
    this.send(socket, ServerEvent.RoomLeft, { roomId: payload.roomId })
    if (room) this.broadcastRoomState(room.id)
  }

  @SubscribeMessage(ClientEvent.PlayerReady)
  playerReady(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.PlayerReady, playerReadyPayloadSchema, body)
    if (!payload) return

    const room = this.rooms.setReady(payload.roomId, user.userId, payload.ready)
    this.broadcastRoomState(room.id)
  }

  // --- Game ------------------------------------------------------------------

  @SubscribeMessage(ClientEvent.GameStart)
  gameStart(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.GameStart, gameStartPayloadSchema, body)
    if (!payload) return

    const room = this.rooms.start(payload.roomId, user.userId)
    // A shared seed makes every authoritative session reproduce the same bag.
    const seed = Math.floor(Math.random() * 0xff_ff_ff_ff)
    this.emitToRoom(room.id, ServerEvent.GameStarted, { roomId: room.id, seed, startedAt: Date.now() })
    this.broadcastRoomState(room.id)
    // NEXT STEP: spin up one authoritative GamesService session per member with
    // this seed and start the fixed-timestep loop + ~5–10 Hz snapshot fan-out.
  }

  @SubscribeMessage(ClientEvent.PlayerAction)
  playerAction(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.PlayerAction, playerActionPayloadSchema, body)
    if (!payload) return

    // NEXT STEP: forward (payload.action, payload.seq) into this player's
    // authoritative session so the server validates/simulates the input. The
    // sequence number lets the session reject stale/duplicate actions.
    this.logger.verbose(`action ${payload.action} seq=${payload.seq} user=${user.userId} room=${payload.roomId}`)
  }

  // --- Helpers ---------------------------------------------------------------

  private requireAuth(socket: TypedSocket): { userId: string; displayName: string } | null {
    if (!socket.data.userId) {
      this.error(socket, undefined, 'UNAUTHENTICATED', 'Authenticate before sending this event')
      return null
    }
    return { userId: socket.data.userId, displayName: socket.data.displayName ?? socket.data.userId }
  }

  /** Validate an inbound payload; on failure emit a scoped error and return null. */
  private validate<T>(socket: TypedSocket, event: string, schema: ZodSchema<T>, body: unknown): T | null {
    const result = schema.safeParse(body)
    if (!result.success) {
      this.error(socket, event, 'INVALID_PAYLOAD', result.error.issues.map((i) => i.message).join('; '))
      return null
    }
    return result.data
  }

  private broadcastRoomState(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (room) this.emitToRoom(roomId, ServerEvent.RoomState, this.rooms.toState(room))
  }

  /** Emit a versioned, sequenced envelope to one socket. */
  private send<T>(socket: TypedSocket, event: string, data: T): void {
    socket.emit(event, this.envelope(socket, data))
  }

  /** Emit to every socket in a room. Sequence here is per-room-broadcast, not per-socket. */
  private emitToRoom<T>(roomId: string, event: string, data: T): void {
    const envelope: ServerEnvelope<T> = {
      protocolVersion: PROTOCOL_VERSION,
      seq: -1,
      ts: Date.now(),
      data
    }
    this.server.to(roomId).emit(event, envelope)
  }

  private error(socket: TypedSocket, event: string | undefined, code: string, message: string): void {
    this.send(socket, ServerEvent.Error, { event, code, message })
  }

  private envelope<T>(socket: TypedSocket, data: T): ServerEnvelope<T> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      seq: socket.data.outSeq++,
      ts: Date.now(),
      data
    }
  }
}
