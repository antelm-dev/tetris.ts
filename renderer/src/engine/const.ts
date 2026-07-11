/**
 * Standard board dimensions, in cells. The engine takes its size as a
 * constructor option, so these are only the defaults every caller passes — but
 * they live here, next to the pieces, rather than in the render layer that
 * happens to also need them for its world-space maths.
 */
export const COLS = 10
export const ROWS = 20

export const PIECES_SHAPES = {
  O: [
    [1, 1],
    [1, 1]
  ],
  I: [[1, 1, 1, 1]],
  T: [
    [1, 1, 1],
    [0, 1, 0]
  ],
  L: [
    [1, 1, 1],
    [1, 0, 0]
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1]
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0]
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1]
  ]
} as const

export type PieceName = keyof typeof PIECES_SHAPES
