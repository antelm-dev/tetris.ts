export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** Smoothstep — an S-curve on [0, 1], used to soften fades. */
export const smooth = (t: number): number => t * t * (3 - 2 * t)

/** 0 → 1 → 0 hump used for the stat bump; peaks mid-animation. */
export const hump = (b: number): number => Math.sin(clamp01(b) * Math.PI)

/**
 * Frame-rate-independent smoothing factor for an exponential ease: given a
 * frame time `dt` (seconds) and a `rate`, returns the fraction of the remaining
 * distance to cover this frame, so `v += (target - v) * easeK(dt, rate)` settles
 * at the same speed regardless of frame rate.
 */
export const easeK = (dt: number, rate: number): number => 1 - Math.exp(-dt * rate)
