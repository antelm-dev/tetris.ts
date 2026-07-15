import type { RandomFn } from '../engine'

/**
 * A small, fast, seedable PRNG (mulberry32) for anything that needs
 * reproducible randomness — bot placement selection, garbage hole position,
 * tests — without touching `Math.random`. Not cryptographic; just
 * deterministic and uniform enough for gameplay.
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
