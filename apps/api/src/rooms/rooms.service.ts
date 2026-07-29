import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AppConfigService } from '../config/config.service'
import type { RoomStatePayload, RoomPlayer } from '@tetris/protocol'
import type { Room, RoomMember } from './room.interface'

export interface CreateRoomInput {
  name: string
  hostUserId: string
  hostDisplayName: string
  maxPlayers?: number
  isPrivate?: boolean
}

/**
 * In-memory room registry and membership rules. State is intentionally local to
 * this process for the single-instance foundation; when the server scales, room
 * fan-out moves onto the {@link PubSub} bus and authoritative room state moves to
 * a shared store — this service is the boundary that change happens behind.
 *
 * All the multiplayer-shape invariants live here (capacity, host, ready state)
 * so the gateway stays a thin transport.
 */
@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>()

  constructor(private readonly config: AppConfigService) {}

  create(input: CreateRoomInput): Room {
    const serverMax = this.config.realtime.roomMaxPlayers
    // Clamp the requested cap into [1, serverMax]; design target is up to 100.
    const requested = input.maxPlayers ?? serverMax
    const maxPlayers = Math.max(1, Math.min(requested, serverMax))

    const room: Room = {
      id: randomUUID(),
      name: input.name,
      hostUserId: input.hostUserId,
      maxPlayers,
      isPrivate: input.isPrivate ?? false,
      status: 'lobby',
      members: new Map(),
      createdAt: new Date()
    }
    this.addMember(room, input.hostUserId, input.hostDisplayName)
    this.rooms.set(room.id, room)
    return room
  }

  join(roomId: string, userId: string, displayName: string): Room {
    const room = this.require(roomId)
    if (room.status !== 'lobby') throw new BadRequestException('Room is not accepting players')
    if (!room.members.has(userId) && room.members.size >= room.maxPlayers) {
      throw new BadRequestException('Room is full')
    }
    this.addMember(room, userId, displayName)
    return room
  }

  leave(roomId: string, userId: string): Room | null {
    const room = this.rooms.get(roomId)
    if (!room) return null
    room.members.delete(userId)

    if (room.members.size === 0) {
      this.rooms.delete(roomId)
      return null
    }
    // Hand the host role to any remaining member if the host left.
    if (room.hostUserId === userId) {
      room.hostUserId = room.members.keys().next().value as string
    }
    return room
  }

  setReady(roomId: string, userId: string, ready: boolean): Room {
    const room = this.require(roomId)
    const member = room.members.get(userId)
    if (!member) throw new NotFoundException('Not a member of this room')
    member.ready = ready
    return room
  }

  /**
   * Transition a room to in-progress. Only the host may start, and only from
   * the lobby with everyone ready. Phase 1 requires exactly two active players.
   */
  start(roomId: string, requesterId: string): Room {
    const room = this.require(roomId)
    if (room.hostUserId !== requesterId) throw new ForbiddenException('Only the host can start the game')
    if (room.status !== 'lobby') throw new BadRequestException('Game already started')
    if (room.members.size !== 2) {
      throw new BadRequestException('Phase 1 requires exactly two players')
    }
    const allReady = [...room.members.values()].every((m) => m.ready)
    if (!allReady) throw new BadRequestException('All players must be ready')
    room.status = 'in-progress'
    return room
  }

  /** Mark a finished match so the lobby projection stays truthful after game-over. */
  markFinished(roomId: string): Room | null {
    const room = this.rooms.get(roomId)
    if (!room) return null
    room.status = 'finished'
    return room
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  /** Project a room into the client-facing {@link RoomStatePayload} from the shared protocol. */
  toState(room: Room): RoomStatePayload {
    const players: RoomPlayer[] = [...room.members.values()].map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      ready: m.ready,
      connected: m.connected
    }))
    return {
      roomId: room.id,
      name: room.name,
      hostUserId: room.hostUserId,
      maxPlayers: room.maxPlayers,
      players,
      status: room.status
    }
  }

  private addMember(room: Room, userId: string, displayName: string): void {
    const existing = room.members.get(userId)
    if (existing) {
      existing.connected = true
      return
    }
    const member: RoomMember = { userId, displayName, ready: false, connected: true }
    room.members.set(userId, member)
  }

  private require(roomId: string): Room {
    const room = this.rooms.get(roomId)
    if (!room) throw new NotFoundException('Room not found')
    return room
  }
}
