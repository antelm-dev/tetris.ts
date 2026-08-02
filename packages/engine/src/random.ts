import type { RandomFn } from './Game'

/**
 * A {@link RandomFn} whose internal position can be read and rewound.
 *
 * Rollback netcode re-simulates past ticks, and a re-simulation that re-draws
 * from a *different* point in the stream would silently deal a different bag —
 * a worse desync than the one rollback exists to fix. A plain `() => number`
 * closure cannot expose that position, so seeded streams carry it explicitly.
 */
export type StatefulRandomFn = RandomFn & {
  /** Current position in the stream — opaque, only meaningful to {@link setState}. */
  getState(): number
  /** Rewind (or fast-forward) to a position previously returned by {@link getState}. */
  setState(state: number): void
}

/** Whether `fn` can be rewound — false for `Math.random` and other opaque sources. */
export function isStatefulRandom(fn: RandomFn): fn is StatefulRandomFn {
  const candidate = fn as Partial<StatefulRandomFn>
  return typeof candidate.getState === 'function' && typeof candidate.setState === 'function'
}

/**
 * Seedable mulberry32 PRNG for anything that needs reproducible randomness —
 * piece bags, garbage holes, tests — without touching `Math.random`. Not
 * cryptographic; just deterministic and uniform enough for gameplay.
 *
 * Online matches share this with the authoritative API: each player's bag is
 * `mulberry32(seed)`; garbage holes use a sibling stream derived from the same
 * seed on the server.
 *
 * The whole generator state is the single accumulator `s`, so rewinding is just
 * restoring that integer — see {@link StatefulRandomFn}.
 */
export function mulberry32(seed: number): StatefulRandomFn {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.getState = (): number => s
  next.setState = (state: number): void => {
    s = state >>> 0
  }
  return next
}
