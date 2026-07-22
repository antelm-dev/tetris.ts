import { describe, expect, it } from 'vitest'
import { StatisticsStore, type StatisticsStorage } from '@tetris/renderer/app/statistics'

class MemoryStorage implements StatisticsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('career statistics', () => {
  it('persists totals, highlights, distribution and completed Sprint time', () => {
    const storage = new MemoryStorage()
    const stats = new StatisticsStore(storage)

    stats.startRun()
    stats.recordPiece('T')
    stats.recordPiece('I')
    stats.recordTetris()
    stats.recordTSpin()
    stats.recordPerfectClear()
    stats.recordCombo(4)
    stats.finishRun({ mode: 'sprint', score: 12_500, lines: 40, elapsedMs: 61_230, completed: true })

    const reloaded = new StatisticsStore(storage).snapshot()
    expect(reloaded.gamesPlayed).toBe(1)
    expect(reloaded.totalPlayTimeMs).toBe(61_230)
    expect(reloaded.bestScore).toBe(12_500)
    expect(reloaded.bestSprintMs).toBe(61_230)
    expect(reloaded.tetrises).toBe(1)
    expect(reloaded.tSpins).toBe(1)
    expect(reloaded.perfectClears).toBe(1)
    expect(reloaded.maxCombo).toBe(4)
    expect(reloaded.pieces).toMatchObject({ T: 1, I: 1 })
    expect(reloaded.recentGames[0]).toMatchObject({ mode: 'sprint', completed: true })
  })

  it('keeps only ten games and finalizes a run once', () => {
    const stats = new StatisticsStore(new MemoryStorage())

    for (let i = 0; i < 12; i++) {
      stats.startRun()
      const run = { mode: 'endless' as const, score: i, lines: i, elapsedMs: 1_000, completed: false }
      stats.finishRun(run)
      stats.finishRun(run)
    }

    const snapshot = stats.snapshot()
    expect(snapshot.gamesPlayed).toBe(12)
    expect(snapshot.recentGames).toHaveLength(10)
    expect(snapshot.recentGames[0].score).toBe(11)
  })

  it('does not treat an unfinished Sprint as a best time', () => {
    const stats = new StatisticsStore(new MemoryStorage())
    stats.startRun()
    stats.finishRun({ mode: 'sprint', score: 100, lines: 12, elapsedMs: 20_000, completed: false })
    expect(stats.snapshot().bestSprintMs).toBeNull()
  })

  it('imports older score records without lowering career bests', () => {
    const stats = new StatisticsStore(new MemoryStorage())
    stats.mergeRecords({
      endless: { score: 80_000 },
      marathon: { score: 120_000, elapsedMs: 300_000 },
      sprint: { timeMs: 52_340 },
      ultra: { score: 95_000 }
    })
    stats.mergeRecords({ endless: { score: 10 }, marathon: null, sprint: { timeMs: 60_000 }, ultra: null })

    expect(stats.snapshot()).toMatchObject({ bestScore: 120_000, bestSprintMs: 52_340 })
  })
})
