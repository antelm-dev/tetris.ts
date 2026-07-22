/**
 * The minimal structural slice of the Web Audio API `AudioManager` actually
 * uses. A real `AudioContext` satisfies this with no adapter needed; tests
 * hand in a small hand-written mock instead — see `test/audio/`. Keeping this
 * separate (rather than typing everything against `AudioContext` from `lib.dom`)
 * is what lets those tests build a mock without a real audio device.
 */

export interface MinimalAudioParam {
  value: number
  setValueAtTime(value: number, when: number): void
  linearRampToValueAtTime(value: number, when: number): void
  exponentialRampToValueAtTime(value: number, when: number): void
}

export interface MinimalAudioNode {
  connect(destination: MinimalAudioNode): void
  disconnect(): void
}

export interface MinimalGainNode extends MinimalAudioNode {
  gain: MinimalAudioParam
}

export interface MinimalStereoPannerNode extends MinimalAudioNode {
  pan: MinimalAudioParam
}

export interface MinimalOscillatorNode extends MinimalAudioNode {
  type: OscillatorType
  frequency: MinimalAudioParam
  start(when?: number): void
  stop(when?: number): void
}

export interface MinimalBufferSourceNode extends MinimalAudioNode {
  buffer: AudioBuffer | null
  loop: boolean
  playbackRate: MinimalAudioParam
  start(when?: number): void
  stop(when?: number): void
  addEventListener(type: 'ended', listener: () => void): void
}

export interface MinimalAudioContext {
  readonly state: 'suspended' | 'running' | 'closed'
  readonly destination: MinimalAudioNode
  readonly currentTime: number
  createGain(): MinimalGainNode
  createBufferSource(): MinimalBufferSourceNode
  createStereoPanner?(): MinimalStereoPannerNode
  createOscillator?(): MinimalOscillatorNode
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  close(): Promise<void>
}

/** The real browser constructor, under whichever name it's exposed as. */
export function realAudioContextCtor(): (new () => MinimalAudioContext) | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as {
    AudioContext?: new () => MinimalAudioContext
    webkitAudioContext?: new () => MinimalAudioContext
  }
  return w.AudioContext ?? w.webkitAudioContext
}
