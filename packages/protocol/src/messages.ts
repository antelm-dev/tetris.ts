import type { GameAction } from './schemas'
import type { ProtocolVersion } from './version'

/**
 * Outbound (server -> client) payload types. These are plain interfaces rather
 * than zod schemas: the server is the trusted producer, so the client only
 * needs the shapes, not runtime validation of its own peer.
 */

/** Encoding version for a specific outbound state shape (independent of {@link ProtocolVersion}). */
export type PayloadSchemaVersion = 1

/** Wire cell values — mirrors the engine `Slot` union without importing it. */
export type WireSlot = 0 | 'I' | 'O' | 'T' | 'L' | 'J' | 'S' | 'Z' | 'GARBAGE'

export type WirePieceName = Exclude<WireSlot, 0 | 'GARBAGE'>

/** Active piece on a snapshot; orientation is SRS 0–3. */
export interface WireActivePiece {
  name: WirePieceName
  x: number
  y: number
  orientation: 0 | 1 | 2 | 3
}

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
  /**
   * Shared match seed. Each player's piece bag is `mulberry32(seed)`; garbage
   * hole placement uses `mulberry32(seed ^ 0x9e3779b9)` so clients can reproduce
   * both streams from this value alone.
   */
  seed: number
  startedAt: number
}

/**
 * Compact opponent board update. Deliberately NOT a full 60 Hz board dump:
 * the realtime layer down-samples these to ~5–10 Hz per opponent.
 *
 * `board` is a full-height row-major grid of {@link WireSlot} values. Future
 * queue / hold / bag state is intentionally omitted.
 */
export interface SnapshotPayload {
  schemaVersion: PayloadSchemaVersion
  roomId: string
  userId: string
  /**
   * Snapshot sequence for this player's stream — lets the client drop stale
   * frames. Independent of {@link ServerEnvelope.seq}.
   */
  seq: number
  score: number
  lines: number
  level: number
  board: WireSlot[][]
  activePiece?: WireActivePiece
  gameOver: boolean
}

/**
 * Attack intent (garbage row count). Kept for compatibility; deterministic
 * deliveries use {@link GarbageDeliveryPayload}.
 */
export interface AttackPayload {
  roomId: string
  fromUserId: string
  toUserId: string
  /** Garbage rows sent. */
  amount: number
}

/**
 * Deterministic garbage delivery. Each row carries an explicit hole column so
 * a future client can reproduce the board without the recipient's RNG.
 */
export interface GarbageDeliveryPayload {
  schemaVersion: PayloadSchemaVersion
  roomId: string
  /** Per-match delivery sequence for this room. */
  deliverySeq: number
  fromUserId: string
  toUserId: string
  rows: Array<{ hole: number }>
  /**
   * Lock-boundary counter on the recipient when this delivery is applied
   * (0-based count of locks after match start). Documented so clients can
   * schedule prediction relative to the same boundary the server uses.
   */
  appliedAtLock: number
}

export interface EliminationPayload {
  schemaVersion: PayloadSchemaVersion
  roomId: string
  userId: string
  /** Finishing place (1 = winner); lower is better. */
  place: number
  reason: 'top-out'
}

export interface GameOverStanding {
  userId: string
  place: number
  score: number
  lines: number
}

export interface GameOverPayload {
  schemaVersion: PayloadSchemaVersion
  roomId: string
  standings: GameOverStanding[]
  endedAt: number
}

/** Echo of an accepted client action's sequence, so clients can reconcile input. */
export interface ActionAckPayload {
  schemaVersion: PayloadSchemaVersion
  roomId: string
  /** The client action sequence that was accepted (same as inbound `seq`). */
  seq: number
  action: GameAction
}
