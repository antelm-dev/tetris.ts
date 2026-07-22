import { describe, it, expect } from 'vitest'
import { AudioManager } from '@tetris/renderer/audio/AudioManager'
import { MockAudioContext, fakeFetch } from './mocks'

/**
 * Waits out both the cluster's microtask flush *and* any staggered accent
 * plays scheduled with `setTimeout` (see `AudioManager.flushCluster` — up to
 * 110ms for a level-up accent). A real timer is simplest here; `AudioManager`
 * doesn't take an injectable clock, and faking one would only complicate
 * these tests for no real benefit.
 */
function flush(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('AudioManager — unavailable/broken Web Audio', () => {
  it('disables itself instead of throwing when no AudioContext is available', async () => {
    const audio = new AudioManager({ createContext: () => undefined })
    await expect(audio.unlock()).resolves.toBeUndefined()
    expect(() => audio.play('move')).not.toThrow()
    expect(() => audio.dispose()).not.toThrow()
  })

  it('disables itself instead of throwing when creating the context throws', async () => {
    const audio = new AudioManager({
      createContext: () => {
        throw new Error('no audio device')
      }
    })
    await expect(audio.unlock()).resolves.toBeUndefined()
    expect(() => audio.lock(false)).not.toThrow()
    await flush()
  })

  it('a missing/broken asset does not block the rest of the manifest', async () => {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({
      createContext: () => ctx,
      fetchImpl: fakeFetch((url) => url.includes('SFX_PieceHold'))
    })
    await audio.unlock()
    audio.hold() // silently no-ops: never loaded
    audio.move() // unaffected by hold's failed fetch
    expect(ctx.sources).toHaveLength(1)
  })
})

describe('AudioManager — playback', () => {
  async function setup(fail: (url: string) => boolean = () => false) {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({ createContext: () => ctx, fetchImpl: fakeFetch(fail) })
    await audio.unlock()
    return { ctx, audio }
  }

  it('plays a mapped one-shot on move/rotate/hold', async () => {
    const { ctx, audio } = await setup()
    audio.rotate(false)
    expect(ctx.sources).toHaveLength(1)
    audio.hold()
    expect(ctx.sources).toHaveLength(2)
  })

  it('throttles repeated move triggers (DAS/ARR-safe)', async () => {
    const { ctx, audio } = await setup()
    audio.move()
    audio.move() // same tick — well under the 40ms throttle window
    expect(ctx.sources).toHaveLength(1)
  })

  it('caps polyphony per sound instead of stacking indefinitely', async () => {
    const { ctx, audio } = await setup()
    for (let i = 0; i < 8; i++) audio.rotate(false)
    // No `onended` ever fires in this mock, so the cap (2 for `rotate`) holds throughout.
    expect(ctx.sources).toHaveLength(2)
  })

  it('silences the bot side entirely for routine move/rotate/hold', async () => {
    const { ctx, audio } = await setup()
    audio.move('bot')
    audio.rotate(false, 'bot')
    audio.hold('bot')
    expect(ctx.sources).toHaveLength(0)
  })
})

describe('AudioManager — simultaneous lock-cluster events', () => {
  it('collapses one lock worth of events into a resolved, staggered mix', async () => {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({ createContext: () => ctx, fetchImpl: fakeFetch() })
    await audio.unlock()

    audio.lock(true)
    audio.clear([0, 1, 2, 3], 4, 1)
    await flush()

    // Tetris: the ducked lock impact plus the Tetris voice, nothing else.
    expect(ctx.sources).toHaveLength(2)
  })

  it('reduces gain and pans the bot side, keeping its important events audible', async () => {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({ createContext: () => ctx, fetchImpl: fakeFetch() })
    await audio.unlock()

    audio.lock(true, 'bot')
    audio.clear([0, 1, 2, 3], 4, 1, 'bot')
    await flush()

    expect(ctx.sources).toHaveLength(2)
    expect(ctx.panners).toHaveLength(2)
    expect(ctx.panners.every((p) => p.pan.value === 0.65)).toBe(true)
    // Base gains from `resolveCluster` are 0.25 (ducked impact) and 1 (Tetris voice); both scaled by the 0.4 bot multiplier.
    const gains = ctx.gains.slice(3).map((g) => g.gain.value) // first 3 gains are the master/music/sfx buses
    expect(gains.sort()).toEqual([0.1, 0.4].sort())
  })

  it('keeps player-side clusters isolated from a concurrent bot-side cluster', async () => {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({ createContext: () => ctx, fetchImpl: fakeFetch() })
    await audio.unlock()

    // Interleaved, as a Versus frame that locks both boards in the same tick would.
    audio.lock(false, 'player')
    audio.lock(true, 'bot')
    audio.combo(1, 1, 'player')
    audio.clear([0, 1, 2, 3], 4, 1, 'bot')
    await flush()

    // player: lock (ducked, combo present) + a delayed combo accent = 2 sources.
    // bot: lock (ducked) + clearTetris = 2 sources. Total 4, not a 7-event mush.
    expect(ctx.sources).toHaveLength(4)
    expect(ctx.panners).toHaveLength(2) // only the bot-side pair is panned
  })
})

describe('AudioManager — volumes and mute', () => {
  it('mute is immediate and never disturbs the stored bus volumes', async () => {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({ createContext: () => ctx, fetchImpl: fakeFetch() })
    await audio.unlock()
    // Creation order in `unlock()`: master, music bus, sfx bus.
    const [master, musicBus, sfxBus] = ctx.gains

    audio.setMusicVolume(0.5)
    audio.setEffectsVolume(0.6)
    expect(musicBus.gain.value).toBe(0.5)
    expect(sfxBus.gain.value).toBe(0.6)

    audio.setMuted(true)
    expect(master.gain.value).toBe(0)
    expect(musicBus.gain.value).toBe(0.5)
    expect(sfxBus.gain.value).toBe(0.6)

    audio.setMuted(false)
    expect(master.gain.value).toBe(1)
    expect(musicBus.gain.value).toBe(0.5)
    expect(sfxBus.gain.value).toBe(0.6)
  })

  it('does not start new one-shots while muted', async () => {
    const ctx = new MockAudioContext()
    const audio = new AudioManager({ createContext: () => ctx, fetchImpl: fakeFetch() })
    await audio.unlock()
    audio.setMuted(true)
    audio.rotate(false)
    expect(ctx.sources).toHaveLength(0)
  })
})
