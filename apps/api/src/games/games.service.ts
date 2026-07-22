import { Injectable, Logger } from '@nestjs/common'
import { EngineGameSession } from './engine-game-session'
import type { EngineGame } from './engine-game-session'
import type { AuthoritativeGameSession } from './interfaces/authoritative-session.interface'

/**
 * Owns the lifecycle of authoritative game sessions, keyed by room. This is the
 * server-side home of the shared engine: when a match starts, one
 * {@link AuthoritativeGameSession} is created per player, fed sequenced inputs
 * from the realtime layer, advanced on a fixed tick, and polled for snapshots.
 *
 * The engine instances themselves are supplied by the caller (see
 * {@link createSession}) rather than constructed here, keeping this service free
 * of a runtime dependency on the source-shipped `@tetris/engine`. Building the
 * fixed-timestep loop and broadcasting snapshots is deliberately left for the
 * next step — this foundation only establishes ownership and the contract.
 */
@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name)
  /** roomId -> (userId -> session) */
  private readonly sessions = new Map<string, Map<string, AuthoritativeGameSession>>()

  /**
   * Register an authoritative session for a player in a room. The `engine` is a
   * `Game` constructed with a seeded RNG (shared per match for determinism);
   * the caller owns engine construction so this module never imports it at
   * runtime.
   */
  createSession(roomId: string, userId: string, engine: EngineGame): AuthoritativeGameSession {
    const session = new EngineGameSession(userId, engine)
    const room = this.sessions.get(roomId) ?? new Map<string, AuthoritativeGameSession>()
    room.set(userId, session)
    this.sessions.set(roomId, room)
    return session
  }

  getSession(roomId: string, userId: string): AuthoritativeGameSession | undefined {
    return this.sessions.get(roomId)?.get(userId)
  }

  getRoomSessions(roomId: string): AuthoritativeGameSession[] {
    return [...(this.sessions.get(roomId)?.values() ?? [])]
  }

  endRoom(roomId: string): void {
    this.sessions.delete(roomId)
    this.logger.log(`Cleared game sessions for room ${roomId}`)
  }
}
