import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module'
import { LoggerModule } from './common/logger/logger.module'
import { PubSubModule } from './common/pubsub/pubsub.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { RoomsModule } from './rooms/rooms.module'
import { GamesModule } from './games/games.module'
import { RealtimeModule } from './realtime/realtime.module'

/**
 * The composition root. A single modular monolith: REST and WebSocket ship in
 * one deployment. Modules are split along future scaling seams (auth, users,
 * rooms, games, realtime) so the app can be pulled apart later *if measurement
 * justifies it* — not preemptively.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PubSubModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    GamesModule,
    RealtimeModule
  ]
})
export class AppModule {}
