import type { PieceName } from '@tetris/engine'
import type { ModeId } from '@tetris/engine/modes'
import type { RecordsState } from './records'

const STORAGE_KEY = 'tetris.ts.statistics.v1'
const HISTORY_LIMIT = 10

export const PIECE_ORDER: PieceName[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

export interface RecentGame {
  mode: ModeId
  score: number
  lines: number
  elapsedMs: number
  completed: boolean
  playedAt: number
}

export interface StatisticsState {
  gamesPlayed: number
  totalPlayTimeMs: number
  bestScore: number
  bestSprintMs: number | null
  tetrises: number
  tSpins: number
  perfectClears: number
  maxCombo: number
  pieces: Record<PieceName, number>
  recentGames: RecentGame[]
}

export interface StatisticsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function emptyStatistics(): StatisticsState {
  return {
    gamesPlayed: 0,
    totalPlayTimeMs: 0,
    bestScore: 0,
    bestSprintMs: null,
    tetrises: 0,
    tSpins: 0,
    perfectClears: 0,
    maxCombo: 0,
    pieces: { I: 0, O: 0, T: 0, S: 0, Z: 0, J: 0, L: 0 },
    recentGames: []
  }
}

/** Local, best-effort career statistics. A storage failure never interrupts play. */
export class StatisticsStore {
  private state: StatisticsState
  private runFinished = false

  constructor(private readonly storage?: StatisticsStorage) {
    this.state = this.load()
  }

  public snapshot(): StatisticsState {
    return structuredClone(this.state)
  }

  public startRun(): void {
    this.runFinished = false
  }

  public recordPiece(name: PieceName): void {
    this.state.pieces[name]++
    this.save()
  }

  public recordTetris(): void {
    this.state.tetrises++
    this.save()
  }

  public recordTSpin(): void {
    this.state.tSpins++
    this.save()
  }

  public recordPerfectClear(): void {
    this.state.perfectClears++
    this.save()
  }

  public recordCombo(length: number): void {
    if (length <= this.state.maxCombo) return
    this.state.maxCombo = length
    this.save()
  }

  /** Preserve records earned before the career-statistics feature existed. */
  public mergeRecords(records: RecordsState): void {
    const bestScore = Math.max(
      records.endless?.score ?? 0,
      records.marathon?.score ?? 0,
      records.ultra?.score ?? 0
    )
    const bestSprintMs = records.sprint?.timeMs ?? null
    let changed = false
    if (bestScore > this.state.bestScore) {
      this.state.bestScore = bestScore
      changed = true
    }
    if (bestSprintMs !== null && (this.state.bestSprintMs === null || bestSprintMs < this.state.bestSprintMs)) {
      this.state.bestSprintMs = bestSprintMs
      changed = true
    }
    if (changed) this.save()
  }

  public finishRun(game: Omit<RecentGame, 'playedAt'>): void {
    if (this.runFinished) return
    this.runFinished = true

    const recent: RecentGame = { ...game, playedAt: Date.now() }
    this.state.gamesPlayed++
    this.state.totalPlayTimeMs += Math.max(0, game.elapsedMs)
    this.state.bestScore = Math.max(this.state.bestScore, game.score)
    if (game.mode === 'sprint' && game.completed) {
      this.state.bestSprintMs =
        this.state.bestSprintMs === null ? game.elapsedMs : Math.min(this.state.bestSprintMs, game.elapsedMs)
    }
    this.state.recentGames = [recent, ...this.state.recentGames].slice(0, HISTORY_LIMIT)
    this.save()
  }

  private load(): StatisticsState {
    if (!this.storage) return emptyStatistics()
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return emptyStatistics()
      const saved = JSON.parse(raw) as Partial<StatisticsState>
      const empty = emptyStatistics()
      return {
        ...empty,
        ...saved,
        pieces: { ...empty.pieces, ...saved.pieces },
        recentGames: Array.isArray(saved.recentGames) ? saved.recentGames.slice(0, HISTORY_LIMIT) : []
      }
    } catch {
      return emptyStatistics()
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // Private browsing, a full quota, or a disabled storage backend must not affect the game.
    }
  }
}

export function browserStatistics(): StatisticsStore {
  try {
    return new StatisticsStore(window.localStorage)
  } catch {
    return new StatisticsStore()
  }
}
