import type { MinimalAudioContext, MinimalGainNode } from './context'

/**
 * No asset in the pack fits "garbage received" — an alert distinct from any
 * clear/lock sound. Rather than force-mapping an unrelated voice line, this
 * synthesizes a short two-tone blip directly with Web Audio (an oscillator
 * ramped down in pitch), so the cue exists without inventing an asset.
 */
export function playGarbageAlert(ctx: MinimalAudioContext, destination: MinimalGainNode, gain: number): void {
  if (!ctx.createOscillator) return
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.frequency.value = 880
  osc.type = 'square'
  env.gain.value = 0
  osc.connect(env)
  env.connect(destination)

  const t0 = ctx.currentTime
  const attack = 0.008
  const hold = 0.05
  const release = 0.09
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(gain, t0 + attack)
  env.gain.setValueAtTime(gain, t0 + attack + hold)
  env.gain.linearRampToValueAtTime(0, t0 + attack + hold + release)
  osc.frequency.setValueAtTime(880, t0)
  osc.frequency.exponentialRampToValueAtTime(440, t0 + attack + hold + release)

  osc.start(t0)
  osc.stop(t0 + attack + hold + release + 0.02)
}
