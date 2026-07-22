import { describe, it, expect } from 'vitest'
import { resolveCluster, type ClusterAccumulator } from '@tetris/renderer/audio/priority'

const empty = (hard = false): ClusterAccumulator => ({ hard })

describe('resolveCluster', () => {
  it('plays a quiet lock impact alone when nothing else happened', () => {
    const plays = resolveCluster(empty(false))
    expect(plays).toEqual([{ id: 'lockSoft', gain: 0.85 }])
  })

  it('plays a quiet hard-drop impact alone when nothing else happened', () => {
    const plays = resolveCluster(empty(true))
    expect(plays).toEqual([{ id: 'lockHard', gain: 0.85 }])
  })

  it('perfect clear is exclusive — no ordinary clear/spin layer alongside it', () => {
    const c: ClusterAccumulator = {
      hard: true,
      perfectClear: { lines: 4, level: 3 },
      clear: { rows: [0, 1, 2, 3], count: 4, level: 3 }
    }
    const plays = resolveCluster(c, () => 'praiseWow')
    expect(plays).toEqual([{ id: 'praiseWow', gain: 1 }])
  })

  it('perfect clear plus a level-up adds a ducked, staggered level-up accent', () => {
    const c: ClusterAccumulator = { hard: false, perfectClear: { lines: 4, level: 3 }, levelUp: 3 }
    const plays = resolveCluster(c, () => 'praiseAmazing')
    expect(plays).toEqual([
      { id: 'praiseAmazing', gain: 1 },
      { id: 'levelUp', gain: 0.55, delayMs: 110 }
    ])
  })

  it('a Tetris ducks the lock impact and plays the Tetris voice', () => {
    const c: ClusterAccumulator = { hard: true, clear: { rows: [0, 1, 2, 3], count: 4, level: 1 } }
    const plays = resolveCluster(c)
    expect(plays).toEqual([
      { id: 'lockHard', gain: 0.25 },
      { id: 'clearTetris', gain: 1, delayMs: 0 }
    ])
  })

  it('single/double/triple clears map to their own voice', () => {
    expect(resolveCluster({ hard: false, clear: { rows: [0], count: 1, level: 1 } })[1].id).toBe('clearSingle')
    expect(resolveCluster({ hard: false, clear: { rows: [0, 1], count: 2, level: 1 } })[1].id).toBe('clearDouble')
    expect(resolveCluster({ hard: false, clear: { rows: [0, 1, 2], count: 3, level: 1 } })[1].id).toBe('clearTriple')
  })

  it('a T-spin takes precedence over the plain clear voice for the same lock', () => {
    const c: ClusterAccumulator = {
      hard: false,
      spin: { name: 'T', lines: 2 },
      clear: { rows: [0, 1], count: 2, level: 1 }
    }
    const plays = resolveCluster(c)
    expect(plays.some((p) => p.id === 'clearDouble')).toBe(false)
    expect(plays.some((p) => p.id === 'spinTDouble')).toBe(true)
  })

  it('a non-T immobile spin uses the EZ voice, with/without a clear', () => {
    expect(resolveCluster({ hard: false, spin: { name: 'L', lines: 0 } })[1].id).toBe('spinEZ')
    expect(resolveCluster({ hard: false, spin: { name: 'S', lines: 1 } })[1].id).toBe('spinEZClear')
  })

  it('back-to-back adds a short accent, gain scaling with chain but capped', () => {
    const low = resolveCluster({ hard: true, b2b: { chain: 2, name: 'I', lines: 4 } })
    const high = resolveCluster({ hard: true, b2b: { chain: 50, name: 'I', lines: 4 } })
    const lowB2B = low.find((p) => p.id === 'b2bTetris')!
    const highB2B = high.find((p) => p.id === 'b2bTetris')!
    expect(lowB2B.gain).toBeCloseTo(0.63)
    expect(highB2B.gain).toBe(0.9) // capped
    expect(lowB2B.delayMs).toBe(70)
  })

  it('back-to-back picks the spin voice id when the chain lock was not a Tetris', () => {
    const plays = resolveCluster({ hard: true, b2b: { chain: 2, name: 'T', lines: 2 } })
    expect(plays.some((p) => p.id === 'b2bSpin')).toBe(true)
  })

  it('combo is a light accent, ducked further when a bigger reward already fired', () => {
    // `ClusterAccumulator.combo.combo` is already the display count here —
    // `AudioManager.combo()` does the engine's raw-count → display +1 before
    // it ever reaches this pure resolver (see AudioManager.test.ts).
    const alone = resolveCluster({ hard: false, combo: { combo: 2, level: 1 } })
    const withClear: ClusterAccumulator = {
      hard: false,
      combo: { combo: 2, level: 1 },
      clear: { rows: [0], count: 1, level: 1 }
    }
    const ducked = resolveCluster(withClear)
    const aloneCombo = alone.find((p) => p.id === 'combo2')!
    const duckedCombo = ducked.find((p) => p.id === 'combo2')!
    expect(aloneCombo.gain).toBe(0.6)
    expect(duckedCombo.gain).toBe(0.35)
  })

  it('a level-up alone still ducks the lock impact underneath it', () => {
    const plays = resolveCluster({ hard: false, levelUp: 5 })
    expect(plays).toEqual([
      { id: 'lockSoft', gain: 0.25 },
      { id: 'levelUp', gain: 0.8 }
    ])
  })
})
