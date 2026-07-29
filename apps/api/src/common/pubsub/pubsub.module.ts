import { Global, Module } from '@nestjs/common'
import { InMemoryPubSub } from './in-memory-pubsub'
import { PUB_SUB } from './pubsub.interface'

/**
 * Provides the {@link PUB_SUB} bus app-wide. Bound to the in-process
 * implementation for now; this is the single place to switch to Redis when the
 * server scales horizontally.
 */
@Global()
@Module({
  providers: [{ provide: PUB_SUB, useClass: InMemoryPubSub }],
  exports: [PUB_SUB]
})
export class PubSubModule {}
