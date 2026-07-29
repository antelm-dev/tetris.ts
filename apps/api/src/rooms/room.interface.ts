export type RoomStatus = 'lobby' | 'in-progress' | 'finished'

export interface RoomMember {
  userId: string
  displayName: string
  ready: boolean
  connected: boolean
}

/**
 * A lobby/match room. Sized to hold up to 100 players by design; the actual cap
 * per room is `maxPlayers`, itself clamped to the server-wide configured
 * maximum (`ROOM_MAX_PLAYERS`). Kept as a plain data holder — behavior lives in
 * {@link RoomsService}.
 */
export interface Room {
  id: string
  name: string
  hostUserId: string
  maxPlayers: number
  isPrivate: boolean
  status: RoomStatus
  members: Map<string, RoomMember>
  createdAt: Date
}
