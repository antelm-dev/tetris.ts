import { Injectable } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import type { PubSub, PubSubHandler } from './pubsub.interface'

/**
 * Single-process {@link PubSub} backed by a Node `EventEmitter`. Correct and
 * sufficient while the API runs as one instance. It is the default binding for
 * {@link PUB_SUB}; a Redis-backed implementation replaces it, unchanged callers,
 * when multiple instances are deployed.
 */
@Injectable()
export class InMemoryPubSub implements PubSub {
  private readonly emitter = new EventEmitter()

  constructor() {
    // Rooms can fan out to many subscribers; lift the default 10-listener cap.
    this.emitter.setMaxListeners(0)
  }

  async publish<T>(channel: string, message: T): Promise<void> {
    this.emitter.emit(channel, message)
  }

  async subscribe<T>(channel: string, handler: PubSubHandler<T>): Promise<() => void> {
    const listener = (message: T) => handler(message)
    this.emitter.on(channel, listener)
    return () => this.emitter.off(channel, listener)
  }
}
