/**
 * Injection token + contract for the cross-instance message bus.
 *
 * Today the API runs as a single process, so the default binding is an
 * in-process event emitter ({@link InMemoryPubSub}) — no Redis, as required for
 * this first foundation. But the realtime layer publishes and subscribes only
 * through this abstraction, so when the server is scaled to multiple instances,
 * swapping in a Redis (or NATS) implementation is a one-provider change and the
 * gateways need no edits. That is the seam that keeps horizontal scaling cheap
 * later without paying for it now.
 */
export const PUB_SUB = Symbol('PUB_SUB')

export type PubSubHandler<T = unknown> = (message: T) => void

export interface PubSub {
  publish<T>(channel: string, message: T): Promise<void>
  /** Subscribe to a channel; returns an unsubscribe function. */
  subscribe<T>(channel: string, handler: PubSubHandler<T>): Promise<() => void>
}
