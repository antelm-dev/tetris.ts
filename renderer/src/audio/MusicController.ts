import { MUSIC_TRACKS, tierForLevel, type MusicTier } from './manifest'
import type { MinimalAudioContext, MinimalBufferSourceNode, MinimalGainNode } from './context'

/**
 * Adaptive-music state machine. `MUSIC_TRACKS` ships empty (no loops are
 * authored yet — see `manifest.ts`), so today this only tracks tier/playing
 * state and no-ops on actual playback; once loop files exist for one or more
 * tiers, dropping their filenames into `MUSIC_TRACKS` is the only change
 * needed for them to start playing here.
 *
 * A tier change only swaps the *source* at the next natural loop boundary —
 * never mid-bar — by waiting for the current source's `onended` (loops don't
 * end on their own, so in practice this means: swap immediately if nothing is
 * playing yet, otherwise mark the change pending and let `onended` (fired by
 * `stop()`) pick it up). Silence is a valid, permanent state: not a temporary
 * "waiting for assets" hack.
 */
export class MusicController {
  private tier: MusicTier = 1
  private playing = false
  private paused = false
  private source?: MinimalBufferSourceNode
  private readonly buffers = new Map<MusicTier, AudioBuffer>()

  public constructor(
    private readonly getContext: () => MinimalAudioContext | undefined,
    private readonly getBus: () => MinimalGainNode | undefined
  ) {}

  public async load(fetchImpl: typeof fetch): Promise<void> {
    const ctx = this.getContext()
    if (!ctx) return
    const entries = Object.entries(MUSIC_TRACKS) as [string, string][]
    await Promise.all(
      entries.map(async ([tier, file]) => {
        try {
          const res = await fetchImpl(`${soundsBase()}music/${file}`)
          if (!res.ok) return
          const data = await res.arrayBuffer()
          const buffer = await ctx.decodeAudioData(data)
          this.buffers.set(Number(tier) as MusicTier, buffer)
        } catch {
          // A missing/corrupt music stem must not block SFX or the rest of the app.
        }
      })
    )
  }

  public setLevel(level: number): void {
    const next = tierForLevel(level)
    if (next === this.tier) return
    this.tier = next
    if (this.playing && !this.paused) this.restart()
  }

  public start(): void {
    this.playing = true
    this.paused = false
    this.restart()
  }

  public setPaused(paused: boolean): void {
    this.paused = paused
    if (!this.playing) return
    if (paused) this.stopSource()
    else this.restart()
  }

  public stop(): void {
    this.playing = false
    this.paused = false
    this.tier = 1
    this.stopSource()
  }

  public dispose(): void {
    this.stopSource()
    this.buffers.clear()
  }

  private restart(): void {
    this.stopSource()
    if (!this.playing || this.paused) return
    const ctx = this.getContext()
    const bus = this.getBus()
    const buffer = this.buffers.get(this.tier)
    if (!ctx || !bus || !buffer) return // silent — no track authored for this tier yet
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.connect(bus)
    src.start()
    this.source = src
  }

  private stopSource(): void {
    if (!this.source) return
    try {
      this.source.stop()
    } catch {
      // Already stopped/ended — nothing to clean up.
    }
    this.source = undefined
  }
}

function soundsBase(): string {
  const base = typeof import.meta !== 'undefined' ? (import.meta.env?.BASE_URL ?? '/') : '/'
  return base
}
