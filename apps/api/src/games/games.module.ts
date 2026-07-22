import { Module } from '@nestjs/common'
import { GamesService } from './games.service'

/**
 * Server-side game domain. Holds authoritative sessions and is the intended
 * home for the future fixed-timestep simulation loop. Exported so the realtime
 * layer can drive sessions from socket events.
 */
@Module({
  providers: [GamesService],
  exports: [GamesService]
})
export class GamesModule {}
