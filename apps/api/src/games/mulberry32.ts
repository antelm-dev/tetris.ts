import type { RandomFn } from '@tetris/engine'

/**
 * Seedable mulberry32 PRNG for authoritative match streams. Copied locally so
 * the API never depends on the renderer package.
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
