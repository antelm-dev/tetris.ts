import type { PieceName } from '../engine'
import { PRAISE_IDS, SFX_FILES, soundUrl, type SfxId } from './manifest'
import { resolveCluster, type ClusterAccumulator } from './priority'
import { MusicController } from './MusicController'
import { playGarbageAlert } from './synth'
import { realAudioContextCtor, type MinimalAudioContext, type MinimalGainNode } from './context'

/**
 * The presentation-layer audio hub: one instance for the whole app (shared by
 * Solo and both sides of a Versus match — see `app/sketch.ts`), owning the
 * Web Audio graph, the sound manifest, the adaptive music controller and the
 * simultaneous-event priority mix. `engine/` never imports this or anything
 * under this directory — every hook here is driven from `app/events.ts`,
 * itself only ever fed by the engine's optional `GameEvents` callbacks.
 *
 * Bus graph: `master` (mute/global) ← `music` and `sfx` (independent
 * volumes), `master` → `destination`.
 */

export type Side = 'player' | 'bot'

export interface PlayOpts {
  /** Linear gain multiplier, applied on top of the sfx bus volume. Default 1. */
  gain?: number
  /** -1 (left) .. 1 (right); omitted plays centered/unpanned. */
  pan?: number
  /** ± playback-rate jitter (e.g. 0.05 = ±5%) so a repeated sound doesn't sound machine-gunned. */
  rateVariance?: number
}

export interface AudioManagerOptions {
  /** Injected for tests — bypasses the real `AudioContext` global entirely. */
  createContext?: () => MinimalAudioContext | undefined
  fetchImpl?: typeof fetch
  random?: () => number
}

/** A one-shot's minimum re-trigger interval, in ms — keeps DAS/ARR-repeated moves from machine-gunning the same sample. */
const THROTTLE_MS: Partial<Record<SfxId, number>> = { move: 40 }
const DEFAULT_POLYPHONY = 4
const POLYPHONY: Partial<Record<SfxId, number>> = { move: 2, rotate: 2 }

const BOT_GAIN = 0.4
const BOT_PAN = 0.65

export class AudioManager {
  private ctx?: MinimalAudioContext
  private master?: MinimalGainNode
  private musicBus?: MinimalGainNode
  private sfxBus?: MinimalGainNode
  private disabled = false
  private unlocking?: Promise<void>

  private readonly buffers = new Map<SfxId, AudioBuffer>()
  private readonly lastPlayedAt = new Map<SfxId, number>()
  private readonly activeVoices = new Map<SfxId, number>()

  private readonly clusters = new Map<Side, ClusterAccumulator>()
  private readonly flushScheduled = new Set<Side>()

  private readonly music: MusicController
  private volumes = { music: 0.7, effects: 0.9, muted: false }

  public constructor(private readonly opts: AudioManagerOptions = {}) {
    this.music = new MusicController(
      () => this.ctx,
      () => this.musicBus
    )
  }

  // --- lifecycle ---------------------------------------------------------

  /** Create/resume the `AudioContext` and kick off manifest loading. Must follow a user gesture; safe to call repeatedly. */
  public unlock(): Promise<void> {
    if (this.disabled) return Promise.resolve()
    if (this.unlocking) return this.unlocking
    this.unlocking = this.doUnlock().finally(() => {
      this.unlocking = undefined
    })
    return this.unlocking
  }

  private async doUnlock(): Promise<void> {
    try {
      if (!this.ctx) {
        const ctx = this.opts.createContext ? this.opts.createContext() : this.createDefaultContext()
        if (!ctx) {
          this.disabled = true
          return
        }
        this.ctx = ctx
        this.master = ctx.createGain()
        this.master.connect(ctx.destination)
        this.musicBus = ctx.createGain()
        this.musicBus.connect(this.master)
        this.sfxBus = ctx.createGain()
        this.sfxBus.connect(this.master)
        this.applyVolumes()
        const fetchImpl = this.resolveFetch()
        await Promise.all([this.loadAll(), fetchImpl ? this.music.load(fetchImpl) : Promise.resolve()])
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume()
    } catch {
      // A missing/blocked Web Audio implementation must never break the game.
      this.disabled = true
    }
  }

  private createDefaultContext(): MinimalAudioContext | undefined {
    const Ctor = realAudioContextCtor()
    return Ctor ? new Ctor() : undefined
  }

  private resolveFetch(): typeof fetch | undefined {
    return this.opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx
    const fetchImpl = this.resolveFetch()
    if (!ctx || !fetchImpl) return
    const entries = Object.entries(SFX_FILES) as [SfxId, string][]
    await Promise.all(
      entries.map(async ([id, file]) => {
        try {
          const res = await fetchImpl(soundUrl(file))
          if (!res.ok) return
          const data = await res.arrayBuffer()
          const buffer = await ctx.decodeAudioData(data)
          this.buffers.set(id, buffer)
        } catch {
          // Optional asset — a missing/corrupt file must not block the rest of the manifest.
        }
      })
    )
  }

  public dispose(): void {
    this.music.dispose()
    this.clusters.clear()
    this.flushScheduled.clear()
    this.buffers.clear()
    this.activeVoices.clear()
    if (this.ctx) {
      try {
        void this.ctx.close()
      } catch {
        // Already closed.
      }
    }
    this.ctx = undefined
    this.master = undefined
    this.musicBus = undefined
    this.sfxBus = undefined
  }

  // --- volumes -------------------------------------------------------------

  public setMusicVolume(v: number): void {
    this.volumes.music = clamp01(v)
    this.applyVolumes()
  }

  public setEffectsVolume(v: number): void {
    this.volumes.effects = clamp01(v)
    this.applyVolumes()
  }

  /** Immediate — flips the master bus, leaving the stored music/effects volumes untouched so unmuting restores them exactly. */
  public setMuted(v: boolean): void {
    this.volumes.muted = v
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.master || !this.musicBus || !this.sfxBus) return
    this.master.gain.value = this.volumes.muted ? 0 : 1
    this.musicBus.gain.value = this.volumes.music
    this.sfxBus.gain.value = this.volumes.effects
  }

  // --- low-level playback ----------------------------------------------------

  /** Play one manifest sound through the sfx bus. Silently no-ops if unloaded/disabled/muted/throttled/over the polyphony cap. */
  public play(id: SfxId, opts: PlayOpts = {}): void {
    if (this.disabled || this.volumes.muted || !this.ctx || !this.sfxBus) return
    const buffer = this.buffers.get(id)
    if (!buffer) return

    const throttle = THROTTLE_MS[id]
    if (throttle !== undefined) {
      const now = this.now()
      const last = this.lastPlayedAt.get(id) ?? -Infinity
      if (now - last < throttle) return
      this.lastPlayedAt.set(id, now)
    }

    const cap = POLYPHONY[id] ?? DEFAULT_POLYPHONY
    const active = this.activeVoices.get(id) ?? 0
    if (active >= cap) return

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    if (opts.rateVariance) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * opts.rateVariance
    const gain = this.ctx.createGain()
    gain.gain.value = Math.max(0, opts.gain ?? 1)
    src.connect(gain)
    if (opts.pan !== undefined && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan))
      gain.connect(panner)
      panner.connect(this.sfxBus)
    } else {
      gain.connect(this.sfxBus)
    }

    this.activeVoices.set(id, active + 1)
    src.addEventListener('ended', () => this.activeVoices.set(id, Math.max(0, (this.activeVoices.get(id) ?? 1) - 1)))
    src.start()
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  private pickPraise(): SfxId {
    const random = this.opts.random ?? Math.random
    return PRAISE_IDS[Math.floor(random() * PRAISE_IDS.length)]
  }

  // --- movement / rotation / hold ------------------------------------------

  // The bot's own moves/rotations/holds are silenced entirely (not just
  // ducked) — at bot speed they'd machine-gun the sfx bus. Only its clears,
  // spins, combos and other "important" lock-cluster events stay audible,
  // reduced and panned toward its board (see `flushCluster`).
  public move(side: Side = 'player'): void {
    if (side === 'bot') return
    this.play('move')
  }

  public rotate(_kicked: boolean, side: Side = 'player'): void {
    if (side === 'bot') return
    this.play('rotate')
  }

  public hold(side: Side = 'player'): void {
    if (side === 'bot') return
    this.play('hold')
  }

  // --- the lock cluster ------------------------------------------------------

  /**
   * A single lock can fire up to seven engine events synchronously — see
   * `priority.ts`'s doc comment. Each `notify*` below stashes into that
   * side's pending cluster and (idempotently) schedules a microtask flush;
   * by the time it runs, every event from this lock's synchronous stack has
   * already landed, so `resolveCluster` sees the whole picture at once.
   */
  private clusterFor(side: Side): ClusterAccumulator {
    let c = this.clusters.get(side)
    if (!c) {
      c = { hard: false }
      this.clusters.set(side, c)
    }
    this.scheduleFlush(side)
    return c
  }

  private scheduleFlush(side: Side): void {
    if (this.flushScheduled.has(side)) return
    this.flushScheduled.add(side)
    queueMicrotask(() => this.flushCluster(side))
  }

  private flushCluster(side: Side): void {
    this.flushScheduled.delete(side)
    const c = this.clusters.get(side)
    this.clusters.delete(side)
    if (!c) return

    const resolved = resolveCluster(c, () => this.pickPraise())
    const sideGain = side === 'bot' ? BOT_GAIN : 1
    const pan = side === 'bot' ? BOT_PAN : undefined
    for (const p of resolved) {
      const fire = (): void => this.play(p.id, { gain: p.gain * sideGain, pan })
      if (p.delayMs) setTimeout(fire, p.delayMs)
      else fire()
    }
  }

  public lock(hard: boolean, side: Side = 'player'): void {
    this.clusterFor(side).hard = hard
  }

  public spin(name: PieceName, lines: number, side: Side = 'player'): void {
    this.clusterFor(side).spin = { name, lines }
  }

  public clear(rows: number[], count: number, level: number, side: Side = 'player'): void {
    this.clusterFor(side).clear = { rows, count, level }
  }

  /** `combo` matches `GameEvents.onCombo` — clears past the first (≥ 1); the displayed/announced count is one higher. */
  public combo(combo: number, level: number, side: Side = 'player'): void {
    this.clusterFor(side).combo = { combo: combo + 1, level }
  }

  public b2b(chain: number, name: PieceName, lines: number, side: Side = 'player'): void {
    this.clusterFor(side).b2b = { chain, name, lines }
  }

  public perfectClear(lines: number, level: number, side: Side = 'player'): void {
    this.clusterFor(side).perfectClear = { lines, level }
  }

  public levelUp(level: number, side: Side = 'player'): void {
    this.clusterFor(side).levelUp = level
    this.setLevel(level)
  }

  // --- level / transport -----------------------------------------------------

  public setLevel(level: number): void {
    this.music.setLevel(level)
  }

  /** Ducks/pauses the music and gives a light button-click cue for the toggle itself. */
  public setPaused(paused: boolean): void {
    this.music.setPaused(paused)
    this.play('buttonClick', { gain: 0.35 })
  }

  public start(side: Side = 'player'): void {
    if (side === 'bot') return // only the player's run drives music/lifecycle cues
    this.music.start()
    this.play('gameStart', { gain: 0.7 })
  }

  public gameOver(side: Side = 'player'): void {
    if (side === 'bot') {
      // The bot topping out means the player won the match. No dedicated
      // "victory" asset exists yet (see manifest.ts's doc comment), so this
      // borrows the perfect-clear praise pool rather than the somber
      // game-over cue, at the reduced bot-side gain/pan.
      this.play(this.pickPraise(), { gain: 0.9 * BOT_GAIN, pan: BOT_PAN })
    } else {
      this.play('gameOver')
    }
    this.music.stop()
  }

  public complete(): void {
    this.play('complete')
    this.music.stop()
  }

  public garbageReceived(count: number, side: Side = 'player'): void {
    if (side === 'bot' || count <= 0) return
    if (this.disabled || this.volumes.muted || !this.ctx || !this.sfxBus) return
    playGarbageAlert(this.ctx, this.sfxBus, 0.5)
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
