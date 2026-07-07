import type { PieceName } from '../tetris'

/** Edge length of a single cell, in world units (~pixels before the fit-scale). */
export const CELL = 34
export const COLS = 10
export const ROWS = 20

export type RGB = [number, number, number]

/**
 * A modern, slightly desaturated take on the Tetris guideline palette. Each
 * piece carries a base body colour and a brighter face colour used for the
 * bevelled top of every block, which sells the pseudo-3D look under lighting.
 */
export const PALETTE: Record<PieceName, { body: RGB; face: RGB; glow: RGB }> = {
  I: { body: [56, 200, 214], face: [150, 244, 250], glow: [80, 220, 235] },
  O: { body: [232, 200, 84], face: [255, 238, 150], glow: [245, 214, 110] },
  T: { body: [170, 96, 214], face: [214, 158, 246], glow: [190, 120, 235] },
  S: { body: [104, 202, 118], face: [172, 240, 182], glow: [130, 224, 145] },
  Z: { body: [228, 92, 104], face: [255, 158, 166], glow: [240, 118, 128] },
  J: { body: [92, 122, 226], face: [158, 182, 252], glow: [120, 150, 240] },
  L: { body: [232, 150, 74], face: [255, 196, 138], glow: [244, 172, 104] }
}

/** Neutral tones for the board frame, backplate and grid. */
export const INK = {
  wellFill: [14, 16, 24] as RGB,
  wellEdge: [90, 104, 150] as RGB,
  grid: [40, 48, 74] as RGB,
  ghost: [180, 200, 235] as RGB
}

/** Multiply an RGB triple by `k`, clamped to the 0–255 range. */
export function scale(c: RGB, k: number): RGB {
  return [
    Math.max(0, Math.min(255, c[0] * k)),
    Math.max(0, Math.min(255, c[1] * k)),
    Math.max(0, Math.min(255, c[2] * k))
  ]
}

/** Linear blend from `a` to `b`, `t` in [0, 1]. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Field cell (col, row) → centred world coordinates. Accepts fractional
 * col/row so the renderer can interpolate a falling/sliding piece smoothly.
 */
export function cellToWorld(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - (COLS - 1) / 2) * CELL,
    y: (row - (ROWS - 1) / 2) * CELL
  }
}
