/**
 * Canonical event names for the realtime channel, split by direction. Kept as
 * `const` objects (not TS enums) so they erase cleanly and are usable as plain
 * string literals on both client and server.
 */

/** Messages the client sends to the server. */
export const ClientEvent = {
  /** First message after the socket opens — carries the auth token + protocol version. */
  Authenticate: 'client:authenticate',
  RoomCreate: 'client:room:create',
  RoomJoin: 'client:room:join',
  RoomLeave: 'client:room:leave',
  /** Toggle the caller's ready state in the current room. */
  PlayerReady: 'client:player:ready',
  /** Host-only request to start the match once players are ready. */
  GameStart: 'client:game:start',
  /** A tick-stamped, sequenced gameplay input for the authoritative engine. */
  PlayerAction: 'client:player:action',
  /**
   * Clock-sync probe. The client needs the server's match tick to stamp inputs
   * onto the same timeline the server simulates on — see {@link ServerEvent.Pong}.
   */
  Ping: 'client:ping'
} as const

/** Messages the server sends to clients. */
export const ServerEvent = {
  /** Acknowledges {@link ClientEvent.Authenticate}; carries session + protocol version. */
  Connected: 'server:connected',
  /** A recoverable protocol/validation error, keyed to the offending event. */
  Error: 'server:error',
  RoomCreated: 'server:room:created',
  RoomJoined: 'server:room:joined',
  RoomLeft: 'server:room:left',
  /** Room membership / ready-state changed. */
  RoomState: 'server:room:state',
  GameStarted: 'server:game:started',
  /** Reply to {@link ClientEvent.Ping}, carrying the server's current match tick. */
  Pong: 'server:pong',
  /** Echo of an accepted {@link ClientEvent.PlayerAction}, with the tick it landed on. */
  ActionAcknowledged: 'server:player:action:ack',
  /** Down-sampled opponent board state (target ~5–10 Hz, never 60 Hz). */
  Snapshot: 'server:game:snapshot',
  /**
   * Authoritative state for the *recipient's own* board at a confirmed tick.
   *
   * The client predicts locally and is normally right; this is how it finds out
   * when it isn't, and the input it rewinds and replays from. Without this
   * channel a divergence is permanent and silent.
   */
  StateCorrection: 'server:game:correction',
  /**
   * Attack intent (row count) routed from one player toward another.
   * Prefer {@link ServerEvent.GarbageDelivered} once holes are known.
   */
  Attack: 'server:game:attack',
  /**
   * Deterministic garbage rows applied (or queued to apply) at a lock boundary,
   * including per-row hole columns for client prediction.
   */
  GarbageDelivered: 'server:game:garbage',
  /** A player topped out and is out of the match. */
  Elimination: 'server:game:elimination',
  /** The match ended — carries the final standings. */
  GameOver: 'server:game:over'
} as const

export type ClientEventName = (typeof ClientEvent)[keyof typeof ClientEvent]
export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent]
