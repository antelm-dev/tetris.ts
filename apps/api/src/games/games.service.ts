import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { COLS, ROWS, Game, computeAttack } from '@tetris/engine'
import type { GarbageRow, RandomFn } from '@tetris/engine'
import {
  ServerEvent,
  type ActionAckPayload,
  type EliminationPayload,
  type GameAction,
  type GameOverPayload,
  type GarbageDeliveryPayload,
  type SnapshotPayload,
  type WireSlot
} from '@tetris/protocol'
import { EngineGameSession } from './engine-game-session'
import type { AuthoritativeGameSession } from './interfaces/authoritative-session.interface'
import { mulberry32 } from './mulberry32'

/**
 * Deterministic garbage-hole stream derived from the published match seed.
 * Piece bags use `mulberry32(seed)` directly; garbage uses this sibling stream
 * so hole placement never desynchronizes bag draws.
 */
export function matchGarbageSeed(seed: number): number {
  return (seed >>> 0) ^ 0x9e37_79b9
}

/** Fixed simulation step — ~60 Hz authority, snapshots are emitted far less often. */
export const MATCH_STEP_MS = 16
/** Cap catch-up steps per wall-clock tick so a stall cannot runaway-simulate. */
const MAX_STEPS_PER_TICK = 6
/** Opponent snapshots at 10 Hz (within the 5–10 Hz budget). */
export const SNAPSHOT_INTERVAL_MS = 100

export type MatchEmit = {
  /** Sequenced envelope to one authenticated player. */
  toUser: (userId: string, event: string, data: unknown) => void
  /** Room broadcast (shared seed / game-over / room-wide events). */
  toRoom: (roomId: string, event: string, data: unknown) => void
  /** Invoked once after the match has fully stopped and sessions cleared. */
  onEnded?: (roomId: string) => void
}

type PlayerRuntime = {
  userId: string
  game: Game
  session: EngineGameSession
  pendingGarbage: GarbageRow[]
  lastLockSpin: boolean
  /** Number of locks completed (appliedAtLock uses this after increment). */
  lockCount: number
  snapshotSeq: number
  eliminated: boolean
  /** Attack rows produced during the current resolve window. */
  stepAttack: number
}

type MatchRuntime = {
  roomId: string
  seed: number
  startedAt: number
  players: Map<string, PlayerRuntime>
  playerOrder: string[]
  garbageRng: RandomFn
  deliverySeq: number
  timer: ReturnType<typeof setInterval> | null
  lastWallMs: number
  accMs: number
  lastSnapshotAt: number
  ended: boolean
  emit: MatchEmit
}

export type StartMatchResult = {
  seed: number
  startedAt: number
}

/**
 * Owns authoritative match sessions and the fixed-step loop. The gateway stays
 * a transport: it validates payloads, then asks this service to mutate games.
 */
@Injectable()
export class GamesService implements OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name)
  private readonly sessions = new Map<string, Map<string, AuthoritativeGameSession>>()
  private readonly matches = new Map<string, MatchRuntime>()

  onModuleDestroy(): void {
    for (const roomId of this.matches.keys()) this.endMatch(roomId)
  }

  createSession(
    roomId: string,
    userId: string,
    engine: ConstructorParameters<typeof EngineGameSession>[1]
  ): AuthoritativeGameSession {
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

  hasActiveMatch(roomId: string): boolean {
    const match = this.matches.get(roomId)
    return !!match && !match.ended
  }

  /**
   * Create one seeded engine/session per member and start the fixed-step loop.
   * Phase 1 expects exactly two `userIds`.
   */
  startMatch(roomId: string, userIds: string[], seed: number, emit: MatchEmit): StartMatchResult {
    this.endMatch(roomId)

    if (userIds.length !== 2) {
      throw new Error('Phase 1 matches require exactly two players')
    }

    const startedAt = Date.now()
    const players = new Map<string, PlayerRuntime>()
    const roomSessions = new Map<string, AuthoritativeGameSession>()

    const match: MatchRuntime = {
      roomId,
      seed,
      startedAt,
      players,
      playerOrder: [...userIds],
      garbageRng: mulberry32(matchGarbageSeed(seed)),
      deliverySeq: 0,
      timer: null,
      lastWallMs: Date.now(),
      accMs: 0,
      lastSnapshotAt: 0,
      ended: false,
      emit
    }

    userIds.forEach((userId) => {
      // Both players share the declared match seed so clients can reproduce
      // each authoritative bag from {@link GameStartedPayload.seed} alone.
      const game = new Game({
        width: COLS,
        height: ROWS,
        random: mulberry32(seed)
      })
      const session = new EngineGameSession(userId, game)
      const player: PlayerRuntime = {
        userId,
        game,
        session,
        pendingGarbage: [],
        lastLockSpin: false,
        lockCount: 0,
        snapshotSeq: 0,
        eliminated: false,
        stepAttack: 0
      }
      this.wirePlayer(match, player)
      game.start()
      players.set(userId, player)
      roomSessions.set(userId, session)
    })

    this.sessions.set(roomId, roomSessions)
    this.matches.set(roomId, match)
    match.timer = setInterval(() => this.onTimer(match), MATCH_STEP_MS)
    // Emit an immediate first snapshot window so clients are not blank for 100 ms.
    this.emitSnapshots(match, true)
    this.logger.log(`Started match in room ${roomId} seed=${seed}`)
    return { seed, startedAt }
  }

  /** Apply a sequenced action for a live room member. Returns whether it was accepted. */
  applyAction(roomId: string, userId: string, action: GameAction, seq: number): boolean {
    const match = this.matches.get(roomId)
    if (!match || match.ended) return false
    const player = match.players.get(userId)
    if (!player || player.eliminated || player.game.gameOver) return false

    const accepted = player.session.applyAction(action, seq)
    if (!accepted) return false

    const ack: ActionAckPayload = {
      schemaVersion: 1,
      roomId,
      seq,
      action
    }
    match.emit.toUser(userId, ServerEvent.ActionAcknowledged, ack)
    this.resolveAttacks(match)
    this.checkMatchEnd(match)
    return true
  }

  /** Stop the loop and drop sessions for a room. Idempotent. */
  endMatch(roomId: string, notify = false): void {
    const match = this.matches.get(roomId)
    if (match) {
      match.ended = true
      if (match.timer) {
        clearInterval(match.timer)
        match.timer = null
      }
      const onEnded = match.emit.onEnded
      this.matches.delete(roomId)
      this.sessions.delete(roomId)
      if (notify) onEnded?.(roomId)
      return
    }
    this.sessions.delete(roomId)
  }

  endRoom(roomId: string): void {
    this.endMatch(roomId)
    this.logger.log(`Cleared game sessions for room ${roomId}`)
  }

  /** Test helper: net the current step-attack buffers without advancing time. */
  flushAttacks(roomId: string): void {
    const match = this.matches.get(roomId)
    if (match) this.resolveAttacks(match)
  }

  /** Test helper: inspect queued garbage rows for a player. */
  pendingGarbageFor(roomId: string, userId: string): readonly GarbageRow[] {
    return this.matches.get(roomId)?.players.get(userId)?.pendingGarbage ?? []
  }

  /** Test helper: access a live match engine (for scripted event tests). */
  gameFor(roomId: string, userId: string): Game | undefined {
    return this.matches.get(roomId)?.players.get(userId)?.game
  }

  private wirePlayer(match: MatchRuntime, player: PlayerRuntime): void {
    const base = player.game.events
    player.game.events = {
      ...base,
      onSpin: (name, lines) => {
        player.lastLockSpin = true
        base.onSpin?.(name, lines)
      },
      onClear: (rows, count, level) => {
        base.onClear?.(rows, count, level)
        player.stepAttack += computeAttack(count, player.lastLockSpin)
      },
      onLock: (hard) => {
        player.lastLockSpin = false
        base.onLock?.(hard)
        player.lockCount += 1
        this.deliverPendingGarbage(match, player)
      },
      onGameOver: (score) => {
        base.onGameOver?.(score)
        this.handleTopOut(match, player)
      }
    }
  }

  private deliverPendingGarbage(match: MatchRuntime, player: PlayerRuntime): void {
    if (player.pendingGarbage.length === 0) return
    const rows = player.pendingGarbage
    player.pendingGarbage = []
    const appliedAtLock = player.lockCount
    player.game.receiveGarbage(rows)

    const fromUserId = match.playerOrder.find((id) => id !== player.userId) ?? player.userId
    match.deliverySeq += 1
    const payload: GarbageDeliveryPayload = {
      schemaVersion: 1,
      roomId: match.roomId,
      deliverySeq: match.deliverySeq,
      fromUserId,
      toUserId: player.userId,
      rows,
      appliedAtLock
    }
    match.emit.toRoom(match.roomId, ServerEvent.GarbageDelivered, payload)
  }

  private resolveAttacks(match: MatchRuntime): void {
    if (match.ended || match.playerOrder.length !== 2) return
    const [aId, bId] = match.playerOrder
    const a = match.players.get(aId)!
    const b = match.players.get(bId)!
    const net = a.stepAttack - b.stepAttack
    a.stepAttack = 0
    b.stepAttack = 0
    if (net > 0) this.queueGarbage(match, b, net)
    else if (net < 0) this.queueGarbage(match, a, -net)
  }

  private queueGarbage(match: MatchRuntime, target: PlayerRuntime, count: number): void {
    if (count <= 0 || target.eliminated) return
    const rows: GarbageRow[] = Array.from({ length: count }, () => ({
      hole: Math.floor(match.garbageRng() * COLS)
    }))
    target.pendingGarbage.push(...rows)
  }

  private handleTopOut(match: MatchRuntime, player: PlayerRuntime): void {
    if (match.ended || player.eliminated) return
    player.eliminated = true

    const survivors = [...match.players.values()].filter((p) => !p.eliminated)
    const place = survivors.length + 1
    const elimination: EliminationPayload = {
      schemaVersion: 1,
      roomId: match.roomId,
      userId: player.userId,
      place,
      reason: 'top-out'
    }
    match.emit.toRoom(match.roomId, ServerEvent.Elimination, elimination)

    if (survivors.length <= 1) this.finishMatch(match)
  }

  private checkMatchEnd(match: MatchRuntime): void {
    if (match.ended) return
    const alive = [...match.players.values()].filter((p) => !p.eliminated && !p.game.gameOver)
    if (alive.length <= 1) {
      for (const p of match.players.values()) {
        if (!p.eliminated && p.game.gameOver) this.handleTopOut(match, p)
      }
      if (!match.ended) {
        const still = [...match.players.values()].filter((p) => !p.eliminated && !p.game.gameOver)
        if (still.length <= 1) this.finishMatch(match)
      }
    }
  }

  private finishMatch(match: MatchRuntime): void {
    if (match.ended) return

    const ranked = [...match.players.values()].sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1
      if (b.game.score !== a.game.score) return b.game.score - a.game.score
      return b.game.lines - a.game.lines
    })

    const standings = ranked.map((p, index) => ({
      userId: p.userId,
      place: index + 1,
      score: p.game.score,
      lines: p.game.lines
    }))

    // Prefer explicit elimination places when already assigned.
    for (const p of match.players.values()) {
      if (!p.eliminated) continue
      const row = standings.find((s) => s.userId === p.userId)
      if (row) {
        const survivors = match.players.size - [...match.players.values()].filter((x) => x.eliminated).length
        row.place = survivors + 1
      }
    }
    // Re-normalize winner place to 1 when one survivor remains.
    const survivor = ranked.find((p) => !p.eliminated)
    if (survivor) {
      const row = standings.find((s) => s.userId === survivor.userId)
      if (row) row.place = 1
    }
    standings.sort((a, b) => a.place - b.place)

    const payload: GameOverPayload = {
      schemaVersion: 1,
      roomId: match.roomId,
      standings,
      endedAt: Date.now()
    }
    match.emit.toRoom(match.roomId, ServerEvent.GameOver, payload)
    this.endMatch(match.roomId, true)
  }

  private onTimer(match: MatchRuntime): void {
    if (match.ended) return
    const now = Date.now()
    const elapsed = Math.min(now - match.lastWallMs, MATCH_STEP_MS * MAX_STEPS_PER_TICK)
    match.lastWallMs = now
    match.accMs += elapsed

    let steps = 0
    while (match.accMs >= MATCH_STEP_MS && steps < MAX_STEPS_PER_TICK) {
      match.accMs -= MATCH_STEP_MS
      for (const player of match.players.values()) {
        if (player.eliminated || player.game.gameOver) continue
        player.session.advance(MATCH_STEP_MS)
      }
      this.resolveAttacks(match)
      steps++
      if (match.ended) return
    }

    this.emitSnapshots(match, false)
    this.checkMatchEnd(match)
  }

  private emitSnapshots(match: MatchRuntime, force: boolean): void {
    if (match.ended) return
    const now = Date.now()
    if (!force && now - match.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return
    match.lastSnapshotAt = now

    for (const viewerId of match.playerOrder) {
      for (const subject of match.players.values()) {
        if (subject.userId === viewerId) continue
        subject.snapshotSeq += 1
        const projection = subject.session.project()
        const payload: SnapshotPayload = {
          schemaVersion: 1,
          roomId: match.roomId,
          userId: subject.userId,
          seq: subject.snapshotSeq,
          score: projection.score,
          lines: projection.lines,
          level: projection.level,
          board: projection.board as WireSlot[][],
          activePiece: projection.activePiece,
          gameOver: projection.gameOver
        }
        match.emit.toUser(viewerId, ServerEvent.Snapshot, payload)
      }
    }
  }
}
