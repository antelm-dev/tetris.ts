import type { RandomFn } from './Game'

/**
 * Seedable mulberry32 PRNG for anything that needs reproducible randomness —
 * piece bags, garbage holes, tests — without touching `Math.random`. Not
 * cryptographic; just deterministic and uniform enough for gameplay.
 *
 * Online matches share this with the authoritative API: each player's bag is
 * `mulberry32(seed)`; garbage holes use a sibling stream derived from the same
 * seed on the server.
 */
export function mulberry32(seed: number): RandomFn {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
