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
  /** Wall-clock epoch (server time) of tick 0. */
  startedAt: number
  /** Milliseconds per simulation tick — the shared step both sides advance by. */
  tickMs: number
  /**
   * How far back the server will rewind to honor a late input. An input that
   * arrives more than this many ticks late is clamped instead, and the client
   * is corrected. Effectively the maximum one-way latency the match tolerates
   * without visible snapping.
   */
  rollbackWindowTicks: number
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
  /** Match tick this board was sampled at. */
  tick: number
  score: number
  lines: number
  level: number
  board: WireSlot[][]
  activePiece?: WireActivePiece
  gameOver: boolean
}

/**
 * Full private simulation state for one player at one tick — the wire spelling
 * of the engine's `GameState`.
 *
 * Unlike {@link SnapshotPayload} this includes the bag, the hold slot and the
 * RNG position, so it is only ever sent to the player it belongs to. Handing it
 * to an opponent would leak their entire future piece queue.
 */
export interface WireGameState {
  score: number
  streak: number
  b2b: number
  lines: number
  level: number
  elapsedMs: number
  gravityAccMs: number
  lockTimer: number
  lockResets: number
  /** `null` encodes the engine's `-Infinity` (no descent yet). */
  lowestRow: number | null
  lastActionRotate: boolean
  lastRotateKicked: boolean
  canHold: boolean
  gameOver: boolean
  completed: boolean
  paused: boolean
  board: WireSlot[][]
  activePiece?: WireActivePiece
  holdPiece?: WirePieceName
  nextPieces: WirePieceName[]
  bag: WirePieceName[]
  /** Piece-bag RNG position; `null` for an unrewindable source. */
  rng: number | null
}

/**
 * Authoritative correction for the recipient's *own* board.
 *
 * Sent at a confirmed tick — one the server will never rewind past — so the
 * client can restore it and replay its own newer inputs on top. This is the
 * channel that makes a divergence self-healing instead of permanent.
 */
export interface StateCorrectionPayload {
  schemaVersion: PayloadSchemaVersion
  roomId: string
  userId: string
  /** The tick `state` was captured at. */
  tick: number
  state: WireGameState
  /**
   * Why the server sent it: a periodic baseline, or a specific input the client
   * predicted differently (clamped because it arrived past the rollback window).
   */
  reason: 'baseline' | 'clamped-input'
}

/** Reply to a client clock-sync probe. */
export interface PongPayload {
  /** The client's own `clientTime`, echoed for round-trip measurement. */
  clientTime: number
  /** Server wall clock when the pong was sent. */
  serverTime: number
  /** Server's current match tick, or `null` outside an active match. */
  serverTick: number | null
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
   * The match tick these rows enter the well on, for both server and client.
   *
   * Deliberately a tick and not a lock counter: the two sides' lock counts are
   * positions in two different simulations, so scheduling on them made the
   * recipient's board depend on which copy you asked. A tick is the same
   * instant everywhere. The server picks one far enough ahead that clients
   * normally receive it in time; a late arrival is handled by rollback.
   */
  applyAtTick: number
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
  /**
   * The tick the server actually simulated this input on. Equal to the
   * requested `applyTick` unless it arrived too late to rewind to.
   */
  appliedTick: number
  /**
   * True when the input missed its requested tick and was moved forward. The
   * client's prediction is wrong from that tick on, and a
   * {@link StateCorrectionPayload} follows.
   */
  clamped: boolean
}
