import { Module } from '@nestjs/common'
import { RoomsService } from './rooms.service'

/**
 * Owns rooms/lobbies and their membership rules. Exported so the realtime
 * gateway can create/join/leave rooms in response to socket events.
 */
@Module({
  providers: [RoomsService],
  exports: [RoomsService]
})
export class RoomsModule {}
