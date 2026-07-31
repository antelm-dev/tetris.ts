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
import { GamesService } from '../games/games.service'
import { RoomsService } from '../rooms/rooms.service'

/** Per-socket state we attach to `socket.data`. */
interface SocketState {
  userId?: string
  displayName?: string
  /** Current Socket.IO / domain room — at most one per socket. */
  roomId?: string
  /** Server-assigned outbound sequence for this connection. */
  outSeq: number
}

type TypedSocket = Socket & { data: SocketState }

/**
 * Realtime gateway for gameplay under `/game`. Validates every inbound payload
 * against `@tetris/protocol`, wraps outbound messages in sequenced envelopes,
 * and delegates match authority to {@link GamesService}.
 *
 * Phase 1 enforces one current room per socket: create/join while already in a
 * different room is rejected, and ready/start/leave/action require both
 * membership and `socket.data.roomId` equality with the payload room.
 */
@WebSocketGateway({
  namespace: process.env.WS_NAMESPACE ?? '/game',
  cors: { origin: true }
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name)
  /** userId -> live authenticated socket (Phase 1: one connection per user). */
  private readonly socketsByUser = new Map<string, TypedSocket>()

  @WebSocketServer()
  private server!: Server

  constructor(
    private readonly tokens: TokenService,
    private readonly rooms: RoomsService,
    private readonly games: GamesService
  ) {}

  handleConnection(socket: TypedSocket): void {
    socket.data.outSeq = 0
    this.logger.debug(`Socket connected: ${socket.id} (awaiting authenticate)`)
  }

  handleDisconnect(socket: TypedSocket): void {
    const userId = socket.data.userId
    if (userId && this.socketsByUser.get(userId) === socket) {
      this.socketsByUser.delete(userId)
    }
    const roomId = socket.data.roomId
    if (userId && roomId) {
      this.departRoom(socket, roomId, userId)
    }
    this.logger.debug(`Socket disconnected: ${socket.id} user=${userId ?? 'anonymous'} room=${roomId ?? 'none'}`)
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

    // Phase 1 deliberately has no reconnect/resume flow. Do not replace a
    // live socket here: the original socket owns the room membership, and
    // replacing it would let its later disconnect end an active match.
    const existing = this.socketsByUser.get(claims.sub)
    if (existing && existing !== socket && existing.connected) {
      this.error(socket, ClientEvent.Authenticate, 'ALREADY_CONNECTED', 'This user already has an active connection')
      socket.disconnect(true)
      return
    }

    socket.data.userId = claims.sub
    socket.data.displayName = claims.email
    this.socketsByUser.set(claims.sub, socket)
    this.logger.log(`Socket ${socket.id} authenticated as user ${claims.sub} (live=${this.socketsByUser.size})`)
    this.send(socket, ServerEvent.Connected, { userId: claims.sub, sessionId: socket.id })
  }

  // --- Rooms -----------------------------------------------------------------

  @SubscribeMessage(ClientEvent.RoomCreate)
  roomCreate(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.RoomCreate, roomCreatePayloadSchema, body)
    if (!payload) return
    if (!this.ensureNoOtherRoom(socket, ClientEvent.RoomCreate)) return

    const room = this.rooms.create({
      name: payload.name,
      hostUserId: user.userId,
      hostDisplayName: user.displayName,
      maxPlayers: payload.maxPlayers,
      isPrivate: payload.isPrivate
    })
    void socket.join(room.id)
    socket.data.roomId = room.id
    this.send(socket, ServerEvent.RoomCreated, this.rooms.toState(room))
    this.broadcastRoomState(room.id)
  }

  @SubscribeMessage(ClientEvent.RoomJoin)
  roomJoin(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.RoomJoin, roomJoinPayloadSchema, body)
    if (!payload) return
    // Re-joining the socket's current room is allowed; a different room is not.
    if (socket.data.roomId && socket.data.roomId !== payload.roomId) {
      this.error(socket, ClientEvent.RoomJoin, 'ALREADY_IN_ROOM', 'Leave the current room before joining another')
      return
    }

    try {
      const room = this.rooms.join(payload.roomId, user.userId, user.displayName)
      void socket.join(room.id)
      socket.data.roomId = room.id
      this.send(socket, ServerEvent.RoomJoined, this.rooms.toState(room))
      this.broadcastRoomState(room.id)
    } catch (err) {
      this.domainError(socket, ClientEvent.RoomJoin, err)
    }
  }

  @SubscribeMessage(ClientEvent.RoomLeave)
  roomLeave(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.RoomLeave, roomLeavePayloadSchema, body)
    if (!payload) return
    if (!this.requireCurrentMembership(socket, payload.roomId, user.userId, ClientEvent.RoomLeave)) return
    this.departRoom(socket, payload.roomId, user.userId)
  }

  @SubscribeMessage(ClientEvent.PlayerReady)
  playerReady(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.PlayerReady, playerReadyPayloadSchema, body)
    if (!payload) return
    if (!this.requireCurrentMembership(socket, payload.roomId, user.userId, ClientEvent.PlayerReady)) return

    try {
      const room = this.rooms.setReady(payload.roomId, user.userId, payload.ready)
      this.broadcastRoomState(room.id)
    } catch (err) {
      this.domainError(socket, ClientEvent.PlayerReady, err)
    }
  }

  // --- Game ------------------------------------------------------------------

  @SubscribeMessage(ClientEvent.GameStart)
  gameStart(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.GameStart, gameStartPayloadSchema, body)
    if (!payload) return
    if (!this.requireCurrentMembership(socket, payload.roomId, user.userId, ClientEvent.GameStart)) return

    try {
      const room = this.rooms.start(payload.roomId, user.userId)
      const seed = Math.floor(Math.random() * 0xff_ff_ff_ff)
      const userIds = [...room.members.keys()]
      const { startedAt } = this.games.startMatch(room.id, userIds, seed, {
        toUser: (userId, event, data) => this.sendToUser(userId, event, data),
        toRoom: (roomId, event, data) => this.emitToRoomMembers(roomId, event, data),
        onEnded: (roomId) => {
          this.rooms.markFinished(roomId)
          this.broadcastRoomState(roomId)
        }
      })
      this.emitToRoomMembers(room.id, ServerEvent.GameStarted, { roomId: room.id, seed, startedAt })
      this.broadcastRoomState(room.id)
    } catch (err) {
      this.domainError(socket, ClientEvent.GameStart, err)
    }
  }

  @SubscribeMessage(ClientEvent.PlayerAction)
  playerAction(@ConnectedSocket() socket: TypedSocket, @MessageBody() body: unknown): void {
    const user = this.requireAuth(socket)
    if (!user) return
    const payload = this.validate(socket, ClientEvent.PlayerAction, playerActionPayloadSchema, body)
    if (!payload) return
    if (!this.requireCurrentMembership(socket, payload.roomId, user.userId, ClientEvent.PlayerAction, false)) return

    const room = this.rooms.get(payload.roomId)
    if (!room || room.status !== 'in-progress') return
    if (!this.games.hasActiveMatch(payload.roomId)) return

    this.games.applyAction(payload.roomId, user.userId, payload.action, payload.seq)
  }

  // --- Helpers ---------------------------------------------------------------

  /**
   * Leave a room the socket is authorized for. Callers must already have proven
   * current-room membership (or be the disconnect path with matching state).
   */
  private departRoom(socket: TypedSocket, roomId: string, userId: string): void {
    const roomRecord = this.rooms.get(roomId)
    if (!roomRecord?.members.has(userId)) return
    if (socket.data.roomId !== roomId) return

    if (this.games.hasActiveMatch(roomId)) {
      this.logger.log(`User ${userId} left room ${roomId} mid-match — ending the match`)
      this.games.endRoom(roomId)
      this.rooms.markFinished(roomId)
    }
    const room = this.rooms.leave(roomId, userId)
    void socket.leave(roomId)
    socket.data.roomId = undefined
    this.send(socket, ServerEvent.RoomLeft, { roomId })
    if (room) this.broadcastRoomState(room.id)
  }

  /** Reject create when the socket already tracks a current room. */
  private ensureNoOtherRoom(socket: TypedSocket, event: string): boolean {
    if (!socket.data.roomId) return true
    this.error(socket, event, 'ALREADY_IN_ROOM', 'Leave the current room before creating another')
    return false
  }

  /**
   * Require `socket.data.roomId === roomId` and domain membership. Without both,
   * ready/start/leave/action must be no-ops (optionally emitting an error).
   */
  private requireCurrentMembership(
    socket: TypedSocket,
    roomId: string,
    userId: string,
    event: string,
    emitError = true
  ): boolean {
    if (socket.data.roomId !== roomId) {
      if (emitError) this.error(socket, event, 'WRONG_ROOM', 'Not the socket current room')
      return false
    }
    const room = this.rooms.get(roomId)
    if (!room?.members.has(userId)) {
      if (emitError) this.error(socket, event, 'NOT_A_MEMBER', 'Not a member of this room')
      return false
    }
    return true
  }

  private requireAuth(socket: TypedSocket): { userId: string; displayName: string } | null {
    if (!socket.data.userId) {
      this.error(socket, undefined, 'UNAUTHENTICATED', 'Authenticate before sending this event')
      return null
    }
    return { userId: socket.data.userId, displayName: socket.data.displayName ?? socket.data.userId }
  }

  /** Validate an inbound payload; on failure emit a scoped error and return null. */
  private validate<T>(socket: TypedSocket, event: string, schema: ZodSchema<T>, body: unknown): T | null {
    // Nest/Socket.IO may forward the payload as a single-element array.
    const raw = Array.isArray(body) ? body[0] : body
    const result = schema.safeParse(raw)
    if (!result.success) {
      this.error(socket, event, 'INVALID_PAYLOAD', result.error.issues.map((i) => i.message).join('; '))
      return null
    }
    return result.data
  }

  private domainError(socket: TypedSocket, event: string, err: unknown): void {
    const message = err instanceof Error ? err.message : 'Request failed'
    this.error(socket, event, 'DOMAIN_ERROR', message)
  }

  private broadcastRoomState(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (room) this.emitToRoomMembers(roomId, ServerEvent.RoomState, this.rooms.toState(room))
  }

  private sendToUser<T>(userId: string, event: string, data: T): void {
    const socket = this.socketsByUser.get(userId)
    if (socket) this.send(socket, event, data)
  }

  private send<T>(socket: TypedSocket, event: string, data: T): void {
    socket.emit(event, this.envelope(socket, data))
  }

  /**
   * Emit to each room member with a valid per-connection sequence. Avoids the
   * room-wide `seq: -1` placeholder for gameplay streams.
   */
  private emitToRoomMembers<T>(roomId: string, event: string, data: T): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      this.server.to(roomId).emit(event, {
        protocolVersion: PROTOCOL_VERSION,
        seq: -1,
        ts: Date.now(),
        data
      } satisfies ServerEnvelope<T>)
      return
    }
    for (const memberId of room.members.keys()) {
      this.sendToUser(memberId, event, data)
    }
  }

  /**
   * Every rejection in this gateway funnels through here, so this is the single
   * place that needs to log one — no per-handler logging.
   */
  private error(socket: TypedSocket, event: string | undefined, code: string, message: string): void {
    const who = socket.data.userId ?? socket.id
    this.logger.warn(`Rejected ${event ?? 'unknown event'} from ${who}: ${code} — ${message}`)
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
