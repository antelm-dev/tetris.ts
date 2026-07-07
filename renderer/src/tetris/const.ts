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
