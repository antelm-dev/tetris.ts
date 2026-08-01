import { Game } from '@tetris/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineGameSession } from './engine-game-session'
import { GamesService, MATCH_STEP_MS, SNAPSHOT_INTERVAL_MS } from './games.service'
import { GARBAGE_DELAY_TICKS, ROLLBACK_WINDOW_TICKS, ServerEvent, type ActionAckPayload } from '@tetris/protocol'

function seededGame(seed = 1): Game {
  let n = seed
  const game = new Game({
    width: 10,
    height: 20,
    random: () => ((n = (n * 9301 + 49_297) % 233_280), n / 233_280)
  })
  game.start()
  return game
}

describe('EngineGameSession', () => {
  it('drives the real engine and projects board state', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)
    const snap = session.snapshot()
    expect(snap.userId).toBe('user-1')
    expect(snap.board).toHaveLength(20)
    expect(snap.board[0]).toHaveLength(10)
    expect(snap.level).toBe(game.level)
    expect(session.isOver).toBe(game.gameOver)
  })

  it('advances with millisecond gravity via Game.advance', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)
    const y0 = game.activePiece?.y ?? 0
    session.advance(800)
    expect(game.activePiece?.y).toBe(y0 + 1)
    expect(game.elapsedMs).toBe(800)
  })

  it('forwards inputs in sequence order and rejects stale duplicates', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)
    const startX = game.activePiece?.x ?? 0

    expect(session.applyAction('right', 5)).toBe(true)
    const movedX = game.activePiece?.x
    expect(session.applyAction('right', 5)).toBe(false)
    expect(session.applyAction('right', 2)).toBe(false)
    expect(game.activePiece?.x).toBe(movedX)
    expect(movedX).toBe(startX + 1)
  })

  it('ignores pause without mutating the board', () => {
    const game = seededGame()
    const session = new EngineGameSession('user-1', game)
    const x = game.activePiece?.x
    expect(session.applyAction('pause', 1)).toBe(false)
    expect(game.isPaused).toBe(false)
    expect(game.activePiece?.x).toBe(x)
  })
})

describe('GamesService match loop', () => {
  let games: GamesService

  afterEach(() => {
    games?.onModuleDestroy()
  })

  it('starts a two-player match, acknowledges actions, and caps snapshots', () => {
    vi.useFakeTimers()
    games = new GamesService()
    const events: Array<{ userId?: string; roomId?: string; event: string; data: unknown }> = []

    const started = games.startMatch('room-1', ['u1', 'u2'], 42, {
      toUser: (userId, event, data) => events.push({ userId, event, data }),
      toRoom: (roomId, event, data) => events.push({ roomId, event, data })
    })
    expect(started.seed).toBe(42)

    const snapshotsAtStart = events.filter((e) => e.event === ServerEvent.Snapshot).length
    expect(snapshotsAtStart).toBeGreaterThanOrEqual(2)

    expect(games.applyAction('room-1', 'u1', 'left', 1, 0)).toBe(true)
    expect(events.some((e) => e.event === ServerEvent.ActionAcknowledged && e.userId === 'u1')).toBe(true)

    expect(games.applyAction('room-1', 'u1', 'left', 1, 0)).toBe(false)
    expect(games.applyAction('room-1', 'u3', 'left', 1, 0)).toBe(false)

    const before = events.filter((e) => e.event === ServerEvent.Snapshot).length
    vi.advanceTimersByTime(SNAPSHOT_INTERVAL_MS + MATCH_STEP_MS)
    const after = events.filter((e) => e.event === ServerEvent.Snapshot).length
    expect(after).toBeGreaterThan(before)

    const snapBeforeSecond = events.filter((e) => e.event === ServerEvent.Snapshot).length
    vi.advanceTimersByTime(1000)
    const snapAfterSecond = events.filter((e) => e.event === ServerEvent.Snapshot).length
    const emitted = snapAfterSecond - snapBeforeSecond
    // 2 opponents × ~10 Hz ≈ 20 envelopes/sec; allow headroom but stay << 120.
    expect(emitted).toBeLessThan(40)
    expect(emitted).toBeGreaterThan(10)

    games.endRoom('room-1')
    expect(games.hasActiveMatch('room-1')).toBe(false)
    vi.useRealTimers()
  })

  it('nets simultaneous attacks and schedules explicit-hole garbage on a future tick', () => {
    vi.useFakeTimers()
    games = new GamesService()
    const events: Array<{ event: string; data: unknown }> = []

    games.startMatch('room-g', ['a', 'b'], 7, {
      toUser: (_u, event, data) => events.push({ event, data }),
      toRoom: (_r, event, data) => events.push({ event, data })
    })

    games.stepTicks('room-g', 1)
    // Equal attacks on the same tick cancel — neither side owes the other.
    games.creditAttack('room-g', 'a', 1)
    games.creditAttack('room-g', 'b', 1)
    games.flushAttacks('room-g')
    expect(games.pendingGarbageFor('room-g', 'a')).toHaveLength(0)
    expect(games.pendingGarbageFor('room-g', 'b')).toHaveLength(0)

    games.stepTicks('room-g', 1)
    games.creditAttack('room-g', 'a', 4)
    games.flushAttacks('room-g')
    const pending = games.pendingGarbageFor('room-g', 'b')
    expect(pending).toHaveLength(4)
    expect(pending.every((row) => typeof row.hole === 'number')).toBe(true)

    const garbageEvents = events.filter((e) => e.event === ServerEvent.GarbageDelivered)
    expect(garbageEvents).toHaveLength(1)
    const payload = garbageEvents[0].data as { rows: unknown[]; applyAtTick: number; toUserId: string }
    expect(payload.toUserId).toBe('b')
    expect(payload.rows).toHaveLength(4)
    // Scheduled ahead of the live tick so the recipient can receive it in time.
    expect(payload.applyAtTick).toBeGreaterThan(GARBAGE_DELAY_TICKS - 1)

    games.endRoom('room-g')
    vi.useRealTimers()
  })

  it('holds cross-player effects until the tick is past the rollback window', () => {
    vi.useFakeTimers()
    games = new GamesService()
    const events: Array<{ event: string; data: unknown }> = []

    games.startMatch('room-c', ['a', 'b'], 3, {
      toUser: (_u, event, data) => events.push({ event, data }),
      toRoom: (_r, event, data) => events.push({ event, data })
    })

    games.stepTicks('room-c', 1)
    games.creditAttack('room-c', 'a', 4)

    // Still rewindable, so nothing may be published to the opponent yet.
    games.stepTicks('room-c', ROLLBACK_WINDOW_TICKS - 1)
    expect(events.filter((e) => e.event === ServerEvent.GarbageDelivered)).toHaveLength(0)

    vi.advanceTimersByTime(MATCH_STEP_MS * (ROLLBACK_WINDOW_TICKS + 4))
    expect(events.filter((e) => e.event === ServerEvent.GarbageDelivered).length).toBeGreaterThan(0)

    games.endRoom('room-c')
    vi.useRealTimers()
  })

  it('emits one elimination and one game-over, then clears the timer', () => {
    vi.useFakeTimers()
    games = new GamesService()
    const events: Array<{ event: string; data: unknown }> = []
    let ended = 0

    games.startMatch('room-e', ['a', 'b'], 99, {
      toUser: (_u, event, data) => events.push({ event, data }),
      toRoom: (_r, event, data) => events.push({ event, data }),
      onEnded: () => {
        ended++
      }
    })

    // Bury the well past the top — more rows than the board is tall.
    games.gameFor('room-e', 'a')!.receiveGarbage(25)
    games.stepTicks('room-e', 1)
    // Elimination waits for the tick to become final, not for the engine event.
    expect(events.filter((e) => e.event === ServerEvent.Elimination)).toHaveLength(0)

    games.flushAttacks('room-e')
    expect(events.filter((e) => e.event === ServerEvent.Elimination)).toHaveLength(1)
    expect(events.filter((e) => e.event === ServerEvent.GameOver)).toHaveLength(1)
    expect(games.hasActiveMatch('room-e')).toBe(false)
    expect(ended).toBe(1)

    vi.advanceTimersByTime(MATCH_STEP_MS * 10)
    expect(games.hasActiveMatch('room-e')).toBe(false)
    vi.useRealTimers()
  })

  it('rewinds a late input onto the tick it was stamped for', () => {
    games = new GamesService()
    const acks: ActionAckPayload[] = []
    const noop = { toUser: () => undefined, toRoom: () => undefined }

    // Reference: the input arrives on time and is simulated at tick 4.
    games.startMatch('room-ref', ['a', 'b'], 555, noop)
    games.stepTicks('room-ref', 3)
    games.applyAction('room-ref', 'a', 'left', 0, 4)
    games.stepTicks('room-ref', 8)
    const onTime = games.gameFor('room-ref', 'a')!.serialize()
    games.endRoom('room-ref')

    // Same input, same stamp, but it shows up five ticks late.
    games.startMatch('room-late', ['a', 'b'], 555, {
      toUser: (_u, event, data) => {
        if (event === ServerEvent.ActionAcknowledged) acks.push(data as ActionAckPayload)
      },
      toRoom: () => undefined
    })
    games.stepTicks('room-late', 9)
    games.applyAction('room-late', 'a', 'left', 0, 4)
    games.stepTicks('room-late', 2)
    const rewound = games.gameFor('room-late', 'a')!.serialize()

    expect(acks.at(-1)?.appliedTick).toBe(4)
    expect(acks.at(-1)?.clamped).toBe(false)
    expect(rewound).toEqual(onTime)

    games.endRoom('room-late')
  })

  it('clamps an input older than the rollback window and corrects the client', () => {
    games = new GamesService()
    const toUser: Array<{ event: string; data: unknown }> = []

    games.startMatch('room-x', ['a', 'b'], 21, {
      toUser: (_u, event, data) => toUser.push({ event, data }),
      toRoom: () => undefined
    })

    games.stepTicks('room-x', 40)
    games.flushAttacks('room-x')
    // Tick 1 is long since final — it cannot be rewound to at any price.
    expect(games.applyAction('room-x', 'a', 'left', 0, 1)).toBe(true)

    const ack = toUser.filter((e) => e.event === ServerEvent.ActionAcknowledged).at(-1)?.data as ActionAckPayload
    expect(ack.clamped).toBe(true)
    expect(ack.appliedTick).toBeGreaterThan(1)

    const correction = toUser.filter((e) => e.event === ServerEvent.StateCorrection).at(-1)?.data as {
      reason: string
      tick: number
    }
    expect(correction.reason).toBe('clamped-input')
    expect(correction.tick).toBeGreaterThanOrEqual(0)

    games.endRoom('room-x')
  })

  it('seeds both players from the published shared seed', () => {
    games = new GamesService()
    games.startMatch('room-seed', ['u1', 'u2'], 12345, {
      toUser: () => undefined,
      toRoom: () => undefined
    })
    const a = games.gameFor('room-seed', 'u1')!
    const b = games.gameFor('room-seed', 'u2')!
    expect(a.activePiece?.name).toBe(b.activePiece?.name)
    expect(a.nextPieces.map((p) => p.name)).toEqual(b.nextPieces.map((p) => p.name))
    games.endRoom('room-seed')
  })
})
