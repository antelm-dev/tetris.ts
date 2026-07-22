/**
 * Wire-protocol version. Bump on any breaking change to an event name or
 * payload shape so a client and server can refuse to talk when incompatible.
 * The server sends it in the connection ack; the client sends it on connect.
 */
export const PROTOCOL_VERSION = 1 as const

export type ProtocolVersion = typeof PROTOCOL_VERSION
