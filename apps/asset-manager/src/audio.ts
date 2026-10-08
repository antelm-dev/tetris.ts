/** The single shared element used for playback. */
export const player = new Audio()
player.preload = 'metadata'

// Separate from the player so probing durations never interrupts playback.
const probe = new Audio()
probe.preload = 'metadata'
const durations = new Map<string, Promise<number | undefined>>()
let probeQueue: Promise<unknown> = Promise.resolve()

/** The lookup already started for `url`, if any; never starts a probe. */
export function knownDuration(url: string): Promise<number | undefined> | undefined {
  return durations.get(url)
}

/** One shared lookup per asset URL; the URL embeds updatedAt, so a replaced file is probed again. */
export function loadDuration(url: string): Promise<number | undefined> {
  const known = durations.get(url)
  if (known) return known
  const lookup = probeQueue.then(() => probeDuration(url))
  probeQueue = lookup
  durations.set(url, lookup)
  return lookup
}

function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const listeners = new AbortController()
    const settle = (): void => {
      listeners.abort()
      resolve(Number.isFinite(probe.duration) ? probe.duration : undefined)
    }
    probe.addEventListener('loadedmetadata', settle, { signal: listeners.signal })
    probe.addEventListener('error', settle, { signal: listeners.signal })
    probe.src = url
  })
}
