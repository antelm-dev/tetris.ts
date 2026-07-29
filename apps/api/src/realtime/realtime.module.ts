import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GamesModule } from '../games/games.module'
import { RoomsModule } from '../rooms/rooms.module'
import { RealtimeGateway } from './realtime.gateway'

/**
 * The realtime transport. Lives in the same process as the REST API and depends
 * on the domain modules (auth for token verification, rooms and games) so the
 * gateway stays a thin, validated transport over that domain.
 */
@Module({
  imports: [AuthModule, RoomsModule, GamesModule],
  providers: [RealtimeGateway]
})
export class RealtimeModule {}
