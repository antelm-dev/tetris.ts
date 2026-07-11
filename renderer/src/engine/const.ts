/**
 * Standard board dimensions, in cells. The engine takes its size as a
 * constructor option, so these are only the defaults every caller passes — but
 * they live here, next to the pieces, rather than in the render layer that
 * happens to also need them for its world-space maths.
 */
export const COLS = 10
export const ROWS = 20

/**
 * The seven tetrominoes in their SRS spawn state, each inside a *square*
 * bounding box.
 *
 * The box is the whole point. Rotation is implemented as a matrix transpose
 * (see `Piece.rotate`), which rotates the contents about the centre of the
 * box — so the box, not the piece, is what defines the pivot. A square box
 * keeps that pivot fixed: the 3×3 pieces turn about their centre cell, I turns
 * about the middle of its 4×4 box, and O never moves at all. Trim the padding
 * rows and the box would change shape on every quarter-turn, dragging the piece
 * sideways and downwards with it — which is exactly the bug this replaces.
 *
 * These are the orientations and pivots of the Super Rotation System, and they
 * are what make the {@link SRS_KICKS} offsets mean anything.
 * @see https://tetris.wiki/Super_Rotation_System
 */
export const PIECES_SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0]
  ],
  O: [
    [1, 1],
    [1, 1]
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0]
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0]
  ]
} as const

export type PieceName = keyof typeof PIECES_SHAPES

/** Rotation state: 0 = spawn, 1 = one turn right, 2 = upside-down, 3 = left. */
export type Orientation = 0 | 1 | 2 | 3

/** The five offsets tried, in order, for one from→to rotation. */
type KickRow = ReadonlyArray<readonly [number, number]>
type KickTable = Readonly<Record<string, KickRow>>

/**
 * SRS wall kicks, keyed `${from}>${to}` by rotation state.
 *
 * When a rotation collides, these offsets are tried in order and the first that
 * fits wins; if none do the rotation is rejected outright. They are not a
 * generic "nudge it free" list — they are a deliberately *asymmetric*, hand-
 * tuned table, and that asymmetry is what lets a piece climb into a slot it
 * could never be dropped into. Every T-spin, and the entire feel of rotating
 * against a wall, is encoded here.
 *
 * NOTE ON SIGNS: the published tables use y-up. Our grid counts y *downwards*,
 * so every y below is the published value negated. Mirroring a row by hand is
 * how you get a game that spins beautifully to the left and not at all to the
 * right — don't.
 */
export const SRS_KICKS: KickTable = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2]
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2]
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2]
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2]
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2]
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2]
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2]
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2]
  ]
}

/**
 * The I piece kicks about a different centre from the 3×3 pieces, so it gets
 * its own table — same key scheme, same y-down sign convention. Without this,
 * an I lying flat on the floor simply cannot stand up: it needs a 2-row lift
 * that the JLSTZ table never offers.
 */
export const SRS_KICKS_I: KickTable = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2]
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2]
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1]
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1]
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2]
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2]
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1]
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1]
  ]
}

/** The kick table a piece rotates by. O never kicks — it never moves. */
export function kicksFor(name: PieceName): KickTable | undefined {
  if (name === 'O') return undefined
  return name === 'I' ? SRS_KICKS_I : SRS_KICKS
}
