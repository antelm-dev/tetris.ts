import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { COLS, ROWS, Game, computeAttack } from '@tetris/engine'
import type { GameState, GarbageRow, RandomFn } from '@tetris/engine'
import {
  CORRECTION_INTERVAL_TICKS,
  GARBAGE_DELAY_TICKS,
  ROLLBACK_WINDOW_TICKS,
  ServerEvent,
  TICK_MS,
  type ActionAckPayload,
  type EliminationPayload,
  type GameAction,
  type GameOverPayload,
  type GarbageDeliveryPayload,
  type SnapshotPayload,
  type StateCorrectionPayload,
  type WireGameState,
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

/** Fixed simulation step. Re-exported from the protocol so both sides share one clock. */
export const MATCH_STEP_MS = TICK_MS
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

/** An input bound to the tick it is simulated on. */
type ScheduledInput = {
  seq: number
  action: GameAction
}

/**
 * Everything needed to resume simulation from one tick boundary.
 *
 * The pending garbage queue rides along with the engine state: a rollback that
 * restored the board but not the queue would drop (or double-apply) rows — the
 * board would look right and the *next* lock would be wrong.
 */
type TickHistory = {
  state: GameState
  pending: GarbageRow[]
}

type PlayerRuntime = {
  userId: string
  game: Game
  session: EngineGameSession
  /** Tick -> inputs applied at the start of that tick. */
  inputs: Map<number, ScheduledInput[]>
  /** Tick -> garbage rows that become eligible to enter the well. */
  garbage: Map<number, GarbageRow[]>
  /** Rows eligible but not yet inserted — held until a lock. See {@link stepPlayer}. */
  pending: GarbageRow[]
  /** Tick -> attack rows produced during that tick. Rewritten wholesale on rollback. */
  attacks: Map<number, number>
  /** Tick -> resumable state after that tick. Pruned below the confirmed horizon. */
  history: Map<number, TickHistory>
  /** Highest inbound action sequence accepted, for duplicate/stale rejection. */
  lastSeq: number
  lastLockSpin: boolean
  /** Whether a piece locked during the tick currently being simulated. */
  lockedThisTick: boolean
  /** Attack accumulated during the tick currently being simulated. */
  tickAttack: number
  snapshotSeq: number
  eliminated: boolean
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
  /** Highest tick simulated so far; -1 before the first step. */
  tick: number
  /**
   * Highest tick whose cross-player effects have been committed. Everything at
   * or below it is final and can never be rewound.
   */
  confirmedThrough: number
  lastSnapshotAt: number
  lastCorrectionTick: number
  ended: boolean
  /** The loop-lag warning is emitted once per match, not once per late tick. */
  lagWarned: boolean
  emit: MatchEmit
}

export type StartMatchResult = {
  seed: number
  startedAt: number
}

/**
 * Owns authoritative match sessions and the fixed-step loop. The gateway stays
 * a transport: it validates payloads, then asks this service to mutate games.
 *
 * ## How authority and prediction stay in agreement
 *
 * Every input carries the match tick it belongs to, and this service honors that
 * stamp rather than the moment the packet happened to arrive — rewinding the
 * player's engine and re-simulating when an input turns up late. Because both
 * sides run the same deterministic engine over the same tick sequence, the
 * client's prediction and this simulation agree by construction instead of by
 * luck.
 *
 * Rewinding makes recent ticks provisional, so anything a *second* player can
 * observe — garbage, eliminations — is derived only from ticks older than
 * {@link ROLLBACK_WINDOW_TICKS} ("confirmed"). Nothing already shown to an
 * opponent can then be taken back.
 */
@Injectable()
export class GamesService implements OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name)
  private readonly sessions = new Map<string, Map<string, AuthoritativeGameSession>>()
  private readonly matches = new Map<string, MatchRuntime>()

  onModuleDestroy(): void {
    if (this.matches.size > 0) this.logger.log(`Shutting down — stopping ${this.matches.size} live match(es)`)
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

  /** Current simulated tick for a room, or `null` when no match is live. */
  currentTick(roomId: string): number | null {
    const match = this.matches.get(roomId)
    if (!match || match.ended) return null
    return match.tick
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
      lastWallMs: startedAt,
      accMs: 0,
      tick: -1,
      confirmedThrough: -1,
      lastSnapshotAt: 0,
      lastCorrectionTick: 0,
      ended: false,
      lagWarned: false,
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
        inputs: new Map(),
        garbage: new Map(),
        pending: [],
        attacks: new Map(),
        history: new Map(),
        lastSeq: -1,
        lastLockSpin: false,
        lockedThisTick: false,
        tickAttack: 0,
        snapshotSeq: 0,
        eliminated: false
      }
      this.wirePlayer(player)
      game.start()
      // Tick -1 is the pre-match baseline, so a rollback to tick 0 still has
      // somewhere to rewind to.
      player.history.set(-1, { state: game.serialize(), pending: [] })
      players.set(userId, player)
      roomSessions.set(userId, session)
    })

    this.sessions.set(roomId, roomSessions)
    this.matches.set(roomId, match)
    match.timer = setInterval(() => this.onTimer(match), TICK_MS)
    // Emit an immediate first snapshot window so clients are not blank for 100 ms.
    this.emitSnapshots(match, true)
    this.logger.log(`Started match in room ${roomId} seed=${seed} players=[${userIds.join(', ')}]`)
    return { seed, startedAt }
  }

  /**
   * Accept a tick-stamped input for a live room member.
   *
   * Three cases, all ending with the input simulated on a definite tick: still
   * in the future (schedule it), already simulated but still rewindable (roll
   * back and replay), or older than the confirmed horizon (clamp forward and
   * correct the client — the alternative would be un-sending garbage the
   * opponent has already been shown).
   */
  applyAction(roomId: string, userId: string, action: GameAction, seq: number, applyTick: number): boolean {
    const match = this.matches.get(roomId)
    if (!match || match.ended) return false
    const player = match.players.get(userId)
    if (!player || player.eliminated || player.game.gameOver) return false

    if (seq <= player.lastSeq) return false
    player.lastSeq = seq
    // Versus matches are continuous — a client pause must not freeze authority.
    if (action === 'pause') return false

    const earliestRewindable = match.confirmedThrough + 1
    let appliedTick = applyTick
    let clamped = false

    if (applyTick < earliestRewindable) {
      appliedTick = match.tick + 1
      clamped = true
    }

    this.schedule(player, appliedTick, { seq, action })

    // The tick has already been simulated — rewind to just before it and redo
    // the range so the input lands where the client predicted it would.
    if (!clamped && appliedTick <= match.tick) {
      this.rollback(match, player, appliedTick)
    }

    const ack: ActionAckPayload = {
      schemaVersion: 1,
      roomId,
      seq,
      action,
      appliedTick,
      clamped
    }
    match.emit.toUser(userId, ServerEvent.ActionAcknowledged, ack)

    if (clamped) {
      this.logger.verbose(
        `Room ${roomId}: ${userId} input seq=${seq} for tick ${applyTick} arrived past the confirmed ` +
          `horizon (${match.confirmedThrough}) — clamped to ${appliedTick}`
      )
      this.emitCorrection(match, player, 'clamped-input')
    }

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
      this.logger.log(
        `Match in room ${roomId} stopped after ${Date.now() - match.startedAt}ms (live=${this.matches.size})`
      )
      if (notify) onEnded?.(roomId)
      return
    }
    this.sessions.delete(roomId)
  }

  endRoom(roomId: string): void {
    this.endMatch(roomId)
    this.logger.log(`Cleared game sessions for room ${roomId}`)
  }

  /** Test helper: commit every simulated tick's cross-player effects immediately. */
  flushAttacks(roomId: string): void {
    const match = this.matches.get(roomId)
    if (match) this.confirm(match, match.tick)
  }

  /** Test helper: every garbage row owed to a player, queued or already due. */
  pendingGarbageFor(roomId: string, userId: string): readonly GarbageRow[] {
    const player = this.matches.get(roomId)?.players.get(userId)
    if (!player) return []
    return [...player.pending, ...[...player.garbage.values()].flat()]
  }

  /** Test helper: access a live match engine (for scripted event tests). */
  gameFor(roomId: string, userId: string): Game | undefined {
    return this.matches.get(roomId)?.players.get(userId)?.game
  }

  /** Test helper: advance whole ticks without waiting on the wall clock. */
  stepTicks(roomId: string, count: number): void {
    const match = this.matches.get(roomId)
    if (!match) return
    for (let i = 0; i < count && !match.ended; i++) this.simulateTick(match, match.tick + 1)
  }

  /** Test helper: credit attack rows to a tick's ledger, as a line clear would. */
  creditAttack(roomId: string, userId: string, rows: number, tick?: number): void {
    const match = this.matches.get(roomId)
    const player = match?.players.get(userId)
    if (!match || !player) return
    const at = tick ?? match.tick
    player.attacks.set(at, (player.attacks.get(at) ?? 0) + rows)
  }

  /** Test helper: the board state the client would be corrected to. */
  confirmedStateFor(roomId: string, userId: string): GameState | undefined {
    const match = this.matches.get(roomId)
    return match?.players.get(userId)?.history.get(match.confirmedThrough)?.state
  }

  private wirePlayer(player: PlayerRuntime): void {
    const base = player.game.events
    player.game.events = {
      ...base,
      onSpin: (name, lines) => {
        player.lastLockSpin = true
        base.onSpin?.(name, lines)
      },
      onClear: (rows, count, level) => {
        base.onClear?.(rows, count, level)
        player.tickAttack += computeAttack(count, player.lastLockSpin)
      },
      onLock: (hard) => {
        player.lastLockSpin = false
        base.onLock?.(hard)
        player.lockedThisTick = true
      }
      // Deliberately no `onGameOver` hook: a top-out on an unconfirmed tick can
      // still be rewound away, so elimination is driven from confirmed state in
      // {@link confirm} instead.
    }
  }

  /** Queue an input on a tick, keeping each tick's inputs in sequence order. */
  private schedule(player: PlayerRuntime, tick: number, input: ScheduledInput): void {
    const existing = player.inputs.get(tick)
    if (!existing) {
      player.inputs.set(tick, [input])
      return
    }
    existing.push(input)
    existing.sort((a, b) => a.seq - b.seq)
  }

  /**
   * Rewind `player` to just before `fromTick` and re-simulate up to the present.
   *
   * Replayed ticks rewrite their own attack ledger and history entries, so the
   * outcome is exactly what would have happened had the input arrived on time.
   * Events stay live: on the server they feed attack accounting rather than
   * presentation, and recomputing them is the whole point.
   */
  private rollback(match: MatchRuntime, player: PlayerRuntime, fromTick: number): void {
    const prior = player.history.get(fromTick - 1)
    if (!prior) {
      this.logger.warn(
        `Room ${match.roomId}: no history at tick ${fromTick - 1} for ${player.userId} — skipping rollback`
      )
      return
    }

    player.game.restore(prior.state)
    player.pending = prior.pending.map((row) => ({ ...row }))
    for (let tick = fromTick; tick <= match.tick; tick++) {
      player.attacks.delete(tick)
      this.stepPlayer(player, tick)
    }
  }

  /** Simulate one tick for every player still in the match. */
  private simulateTick(match: MatchRuntime, tick: number): void {
    match.tick = tick
    for (const player of match.players.values()) {
      if (player.eliminated) continue
      this.stepPlayer(player, tick)
    }
  }

  /**
   * One player, one tick: inputs, the fixed advance, then any garbage that has
   * come due.
   *
   * Garbage waits for a lock instead of dropping in mid-piece — rows inserted
   * under an active piece shove it up into the stack. The wait is deterministic
   * now that both sides share a timeline: "the first lock at or after tick N" is
   * the same event in both simulations, which it emphatically was not when each
   * side counted locks in its own private game.
   */
  private stepPlayer(player: PlayerRuntime, tick: number): void {
    // A topped-out player stays on the timeline — frozen, but still recording
    // history so `confirm` can see the top-out and a rollback has somewhere to
    // land. Feeding a dead game inputs would be worse than pointless: the engine
    // treats `push` on a finished game as "restart", so a queued hard drop would
    // silently bring the board back to life.
    if (player.game.gameOver) {
      player.attacks.set(tick, 0)
      player.history.set(tick, {
        state: player.game.serialize(),
        pending: player.pending.map((row) => ({ ...row }))
      })
      return
    }

    for (const input of player.inputs.get(tick) ?? []) {
      player.game.action(input.action)
    }

    const due = player.garbage.get(tick)
    if (due?.length) player.pending.push(...due)

    player.tickAttack = 0
    player.lockedThisTick = false
    player.game.advance(TICK_MS)
    player.attacks.set(tick, player.tickAttack)

    if (player.pending.length > 0 && (player.lockedThisTick || !player.game.activePiece)) {
      const rows = player.pending
      player.pending = []
      player.game.receiveGarbage(rows)
    }

    player.history.set(tick, {
      state: player.game.serialize(),
      pending: player.pending.map((row) => ({ ...row }))
    })
  }

  /**
   * Commit every tick up to `target` that is no longer rewindable.
   *
   * The only place cross-player effects happen. Attacks are netted per tick and
   * turned into garbage; a top-out counts only once its tick is final. Anything
   * published here is permanent, which is exactly why it lags the live tick by
   * {@link ROLLBACK_WINDOW_TICKS}.
   */
  private confirm(match: MatchRuntime, target: number): void {
    if (match.playerOrder.length !== 2) return
    const [aId, bId] = match.playerOrder
    const a = match.players.get(aId)
    const b = match.players.get(bId)
    if (!a || !b) return

    while (match.confirmedThrough < target && !match.ended) {
      const tick = ++match.confirmedThrough

      const net = (a.attacks.get(tick) ?? 0) - (b.attacks.get(tick) ?? 0)
      a.attacks.delete(tick)
      b.attacks.delete(tick)
      if (net > 0) this.queueGarbage(match, b, net)
      else if (net < 0) this.queueGarbage(match, a, -net)

      for (const player of match.players.values()) {
        if (player.eliminated) continue
        if (player.history.get(tick)?.state.gameOver) this.handleTopOut(match, player)
      }

      this.prune(match, tick - 1)
    }
  }

  /** Drop history, inputs and deliveries that can no longer be rewound to. */
  private prune(match: MatchRuntime, below: number): void {
    for (const player of match.players.values()) {
      for (const tick of player.history.keys()) if (tick < below) player.history.delete(tick)
      for (const tick of player.inputs.keys()) if (tick < below) player.inputs.delete(tick)
      for (const tick of player.garbage.keys()) if (tick < below) player.garbage.delete(tick)
    }
  }

  /**
   * Schedule `count` garbage rows onto the target's future timeline and tell the
   * room. Both sides insert the same holes on the same tick.
   */
  private queueGarbage(match: MatchRuntime, target: PlayerRuntime, count: number): void {
    if (count <= 0 || target.eliminated) return
    const rows: GarbageRow[] = Array.from({ length: count }, () => ({
      hole: Math.floor(match.garbageRng() * COLS)
    }))
    const applyAtTick = match.tick + GARBAGE_DELAY_TICKS
    target.garbage.set(applyAtTick, [...(target.garbage.get(applyAtTick) ?? []), ...rows])

    const fromUserId = match.playerOrder.find((id) => id !== target.userId) ?? target.userId
    match.deliverySeq += 1
    const payload: GarbageDeliveryPayload = {
      schemaVersion: 1,
      roomId: match.roomId,
      deliverySeq: match.deliverySeq,
      fromUserId,
      toUserId: target.userId,
      rows,
      applyAtTick
    }
    match.emit.toRoom(match.roomId, ServerEvent.GarbageDelivered, payload)
    this.logger.verbose(
      `Room ${match.roomId}: ${rows.length} garbage row(s) ${fromUserId} -> ${target.userId} at tick ${applyAtTick}`
    )
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
    this.logger.log(`Room ${match.roomId}: ${player.userId} topped out, place ${place}`)

    if (survivors.length <= 1) this.finishMatch(match)
  }

  private checkMatchEnd(match: MatchRuntime): void {
    if (match.ended) return
    const alive = [...match.players.values()].filter((p) => !p.eliminated && !p.game.gameOver)
    if (alive.length > 1) return
    // A top-out ends the match only once its tick is final, so drain the
    // confirmed backlog rather than acting on a still-rewindable game-over.
    this.confirm(match, match.tick)
    if (match.ended) return
    const still = [...match.players.values()].filter((p) => !p.eliminated)
    if (still.length <= 1) this.finishMatch(match)
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
    this.logger.log(
      `Room ${match.roomId} game over: ${standings.map((s) => `#${s.place} ${s.userId} (${s.score})`).join(', ')}`
    )
    this.endMatch(match.roomId, true)
  }

  private onTimer(match: MatchRuntime): void {
    if (match.ended) return
    const now = Date.now()
    const behind = now - match.lastWallMs
    const elapsed = Math.min(behind, TICK_MS * MAX_STEPS_PER_TICK)
    match.lastWallMs = now
    match.accMs += elapsed

    // Hitting the clamp means simulated time was dropped: the loop can no longer
    // keep up and the match is silently running slow. Worth exactly one warning.
    if (behind > elapsed && !match.lagWarned) {
      match.lagWarned = true
      this.logger.warn(`Room ${match.roomId}: match loop ${behind}ms behind, clamped to ${elapsed}ms — dropping time`)
    }

    let steps = 0
    while (match.accMs >= TICK_MS && steps < MAX_STEPS_PER_TICK) {
      match.accMs -= TICK_MS
      this.simulateTick(match, match.tick + 1)
      steps++
      if (match.ended) return
    }

    this.confirm(match, match.tick - ROLLBACK_WINDOW_TICKS)
    if (match.ended) return
    this.emitSnapshots(match, false)
    this.emitCorrections(match)
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
          tick: match.tick,
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

  /**
   * Periodically hand each player the authoritative version of their *own* board
   * at the confirmed tick.
   *
   * Prediction is normally right, so this is usually a no-op the client verifies
   * and discards. It exists for when it isn't: without it a divergence has
   * nothing to correct it and simply persists, which is how two players end up
   * watching two different games.
   */
  private emitCorrections(match: MatchRuntime): void {
    if (match.ended || match.confirmedThrough < 0) return
    if (match.confirmedThrough - match.lastCorrectionTick < CORRECTION_INTERVAL_TICKS) return
    match.lastCorrectionTick = match.confirmedThrough
    for (const player of match.players.values()) {
      if (player.eliminated) continue
      this.emitCorrection(match, player, 'baseline')
    }
  }

  private emitCorrection(match: MatchRuntime, player: PlayerRuntime, reason: 'baseline' | 'clamped-input'): void {
    const tick = match.confirmedThrough
    const entry = player.history.get(tick)
    if (!entry) return
    const payload: StateCorrectionPayload = {
      schemaVersion: 1,
      roomId: match.roomId,
      userId: player.userId,
      tick,
      state: entry.state as WireGameState,
      reason
    }
    match.emit.toUser(player.userId, ServerEvent.StateCorrection, payload)
  }
}
