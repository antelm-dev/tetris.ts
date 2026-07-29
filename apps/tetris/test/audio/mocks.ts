import type {
  MinimalAudioContext,
  MinimalAudioNode,
  MinimalAudioParam,
  MinimalBufferSourceNode,
  MinimalGainNode,
  MinimalOscillatorNode,
  MinimalStereoPannerNode
} from '@tetris/renderer/audio/context'

function param(initial = 1): MinimalAudioParam {
  return {
    value: initial,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}
  }
}

class MockNode implements MinimalAudioNode {
  // Routing is irrelevant to what these tests assert — only that a node was created, with what params.
  connect(): void {
    // intentionally a no-op
  }
  disconnect(): void {
    // intentionally a no-op
  }
}

export class MockGainNode extends MockNode implements MinimalGainNode {
  gain = param(1)
}

export class MockPannerNode extends MockNode implements MinimalStereoPannerNode {
  pan = param(0)
}

export class MockOscillatorNode extends MockNode implements MinimalOscillatorNode {
  type: OscillatorType = 'sine'
  frequency = param(440)
  start(): void {
    // Nothing to schedule — the garbage-alert test only cares that one was created.
  }
  stop(): void {
    // Nothing to schedule — the garbage-alert test only cares that one was created.
  }
}

export class MockBufferSourceNode extends MockNode implements MinimalBufferSourceNode {
  buffer: AudioBuffer | null = null
  loop = false
  playbackRate = param(1)
  started = false
  private readonly endedListeners: (() => void)[] = []

  addEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.push(listener)
  }

  start(): void {
    this.started = true
  }

  stop(): void {
    for (const listener of this.endedListeners) listener()
  }
}

/** A stand-in `AudioContext` — just enough surface for `AudioManager`, with every created node tracked for assertions. */
export class MockAudioContext implements MinimalAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  destination: MinimalAudioNode = new MockNode()
  currentTime = 0
  readonly gains: MockGainNode[] = []
  readonly sources: MockBufferSourceNode[] = []
  readonly panners: MockPannerNode[] = []

  createGain(): MockGainNode {
    const g = new MockGainNode()
    this.gains.push(g)
    return g
  }

  createBufferSource(): MockBufferSourceNode {
    const s = new MockBufferSourceNode()
    this.sources.push(s)
    return s
  }

  createStereoPanner(): MockPannerNode {
    const p = new MockPannerNode()
    this.panners.push(p)
    return p
  }

  createOscillator(): MockOscillatorNode {
    return new MockOscillatorNode()
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
    return {} as AudioBuffer
  }

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.state = 'closed'
  }
}

/** A `fetch` stand-in that resolves every URL to a tiny fake payload — swap `fail` in to simulate a missing/broken asset. */
export function fakeFetch(fail: (url: string) => boolean = () => false): typeof fetch {
  const impl = async (input: RequestInfo | URL) => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url
    if (fail(url)) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
  }
  return impl as unknown as typeof fetch
}
