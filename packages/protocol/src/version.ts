/**
 * Wire-protocol version. Bump on any breaking change to an event name or
 * payload shape so a client and server can refuse to talk when incompatible.
 * The server sends it in the connection ack; the client sends it on connect.
 */
/**
 * v2 moved gameplay onto a shared tick timeline: inputs carry `applyTick`,
 * garbage lands on `applyAtTick` instead of a per-simulation lock counter, and
 * the server can correct a client's own board. A v1 client cannot be honored on
 * that timeline — it would desync — so the mismatch must be a hard refusal.
 */
export const PROTOCOL_VERSION = 2 as const

export type ProtocolVersion = typeof PROTOCOL_VERSION
