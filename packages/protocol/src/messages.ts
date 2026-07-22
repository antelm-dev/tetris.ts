import type { GameAction } from './schemas'
import type { ProtocolVersion } from './version'

/**
 * Outbound (server -> client) payload types. These are plain interfaces rather
 * than zod schemas: the server is the trusted producer, so the client only
 * needs the shapes, not runtime validation of its own peer.
 */

/** Every server message is wrapped so the client can check compatibility and order. */
export interface ServerEnvelope<T> {
  protocolVersion: ProtocolVersion
  /** Server-assigned, monotonically increasing per connection. */
  seq: number
  /** Server send time (ms since epoch). */
  ts: number
  data: T
}

export interface ConnectedPayload {
  userId: string
  /** Server session id for this socket; distinct from the auth user id. */
  sessionId: string
}

/** A recoverable error the client can surface without dropping the connection. */
export interface ErrorPayload {
  /** The event name that triggered it, when known. */
  event?: string
  code: string
  message: string
}

export interface RoomPlayer {
  userId: string
  displayName: string
  ready: boolean
  connected: boolean
}

export interface RoomStatePayload {
  roomId: string
  name: string
  hostUserId: string
  maxPlayers: number
  players: RoomPlayer[]
  status: 'lobby' | 'in-progress' | 'finished'
}

export interface GameStartedPayload {
  roomId: string
  /** Shared seed so every authoritative session and spectator can reproduce the same bag. */
  seed: number
  startedAt: number
}

/**
 * A compact opponent board update. Deliberately NOT a full 60 Hz board dump:
 * the realtime layer down-samples these to ~5–10 Hz per opponent. The exact
 * board encoding is intentionally left open for the next step (delta vs. RLE).
 */
export interface SnapshotPayload {
  roomId: string
  userId: string
  /** Snapshot sequence for this player's stream — lets the client drop stale frames. */
  seq: number
  score: number
  lines: number
  level: number
  /** Placeholder board encoding; to be replaced with a delta/RLE format. */
  board?: number[]
}

export interface AttackPayload {
  roomId: string
  fromUserId: string
  toUserId: string
  /** Garbage rows sent. */
  amount: number
}

export interface EliminationPayload {
  roomId: string
  userId: string
  /** Finishing place (1 = winner); lower is better. */
  place: number
}

export interface GameOverPayload {
  roomId: string
  standings: Array<{ userId: string; place: number; score: number }>
  endedAt: number
}

/** Echo of an accepted client action's sequence, so clients can reconcile input. Not yet emitted. */
export interface ActionAckPayload {
  roomId: string
  seq: number
  action: GameAction
}
