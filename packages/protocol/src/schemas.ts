import { z } from 'zod'
import { PROTOCOL_VERSION } from './version'

/**
 * Runtime schemas for every inbound realtime payload plus the shared value
 * objects. The server validates each incoming message against these; the
 * client can reuse them to stay honest. Nothing here imports NestJS, Fastify
 * or the engine — it is the neutral ground both sides agree on.
 */

/** Opaque identifiers — branded only by convention, kept as strings on the wire. */
export const roomIdSchema = z.string().min(1).max(64)
export const userIdSchema = z.string().min(1).max(64)

/**
 * A monotonically increasing per-connection counter attached to every client
 * action. Lets the authoritative server detect gaps/duplicates and order
 * inputs independently of socket delivery. See {@link playerActionSchema}.
 */
export const sequenceSchema = z.number().int().nonnegative()

/** Client clock reading (ms since epoch). The server never trusts it for authority, only for lag estimation. */
export const clientTimestampSchema = z.number().int().nonnegative()

/**
 * A match tick index — the shared simulation clock, counted from match start at
 * a fixed step (see `TICK_MS`).
 *
 * This is the one number that makes client prediction and server authority
 * agree: an input is not "an action that happened at some wall-clock time", it
 * is "this action, on this tick". Both sides run the same deterministic engine
 * over the same tick sequence, so honoring the stamp makes their simulations
 * identical by construction rather than by luck.
 */
export const tickSchema = z.number().int().nonnegative()

/**
 * Gameplay inputs. Intentionally mirrors `@tetris/engine`'s `Action` union so
 * the authoritative session can forward them straight into the shared engine,
 * but is declared here independently to avoid coupling the protocol to the
 * engine package.
 */
export const gameActionSchema = z.enum([
  'left',
  'right',
  'down',
  'rotate-left',
  'rotate-right',
  'push',
  'hold',
  'pause'
])
export type GameAction = z.infer<typeof gameActionSchema>

// ---------------------------------------------------------------------------
// Inbound (client -> server) payloads
// ---------------------------------------------------------------------------

export const authenticatePayloadSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  /** JWT access token issued by the REST auth flow. */
  token: z.string().min(1)
})
export type AuthenticatePayload = z.infer<typeof authenticatePayloadSchema>

export const roomCreatePayloadSchema = z.object({
  name: z.string().min(1).max(64),
  /** Hard cap on players; server clamps to its own configured maximum (up to 100). */
  maxPlayers: z.number().int().min(1).max(100).optional(),
  isPrivate: z.boolean().optional()
})
export type RoomCreatePayload = z.infer<typeof roomCreatePayloadSchema>

export const roomJoinPayloadSchema = z.object({ roomId: roomIdSchema })
export type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>

export const roomLeavePayloadSchema = z.object({ roomId: roomIdSchema })
export type RoomLeavePayload = z.infer<typeof roomLeavePayloadSchema>

export const playerReadyPayloadSchema = z.object({
  roomId: roomIdSchema,
  ready: z.boolean()
})
export type PlayerReadyPayload = z.infer<typeof playerReadyPayloadSchema>

export const gameStartPayloadSchema = z.object({ roomId: roomIdSchema })
export type GameStartPayload = z.infer<typeof gameStartPayloadSchema>

export const playerActionPayloadSchema = z.object({
  roomId: roomIdSchema,
  /** Per-connection input sequence number — see {@link sequenceSchema}. */
  seq: sequenceSchema,
  /**
   * The match tick this input belongs to — see {@link tickSchema}. The server
   * honors it (rewinding if it has already simulated past it) rather than using
   * arrival time, which is what keeps prediction and authority in step.
   */
  applyTick: tickSchema,
  /** Client-side timestamp for lag estimation; never trusted for authority. */
  ts: clientTimestampSchema,
  action: gameActionSchema
})
export type PlayerActionPayload = z.infer<typeof playerActionPayloadSchema>

export const pingPayloadSchema = z.object({
  /** Echoed back untouched so the client can measure the round trip. */
  clientTime: clientTimestampSchema
})
export type PingPayload = z.infer<typeof pingPayloadSchema>

/** Registry mapping each inbound event to its schema, for a generic validating dispatcher. */
export const inboundSchemas = {
  authenticate: authenticatePayloadSchema,
  roomCreate: roomCreatePayloadSchema,
  roomJoin: roomJoinPayloadSchema,
  roomLeave: roomLeavePayloadSchema,
  playerReady: playerReadyPayloadSchema,
  gameStart: gameStartPayloadSchema,
  playerAction: playerActionPayloadSchema,
  ping: pingPayloadSchema
} as const
