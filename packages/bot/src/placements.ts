import {
  Piece,
  PIECES_SHAPES,
  type Field,
  type PieceName,
  type PlaceResult,
  type Orientation,
} from "@tetris/engine";

/** A legal resting spot for a piece: its rotation, box position and final shape. */
export interface Placement {
  rotation: Orientation;
  x: number;
  y: number;
  shape: number[][];
}

/** The piece's shape after `rotation` quarter-turns from its spawn state. */
function shapeAtOrientation(
  name: PieceName,
  rotation: Orientation,
): number[][] {
  const piece = new Piece(name, PIECES_SHAPES[name]);
  for (let i = 0; i < rotation; i++) piece.rotate("right");
  return piece.shape;
}

/**
 * Drop `shape` straight down column `x`, using the field's own collision
 * rule (`Field.collides`) rather than a re-implementation of it. Returns
 * `undefined` if the column is out of bounds for this shape at every row.
 */
function dropAt(
  field: Field,
  name: PieceName,
  shape: number[][],
  rotation: Orientation,
  x: number,
): Placement | undefined {
  const probe = new Piece(name, shape);
  probe.x = x;
  probe.y = -shape.length;
  if (field.collides(probe)) return undefined; // out of horizontal bounds
  while (true) {
    const next = probe.clone();
    next.y++;
    if (field.collides(next)) break;
    probe.y++;
  }
  return { rotation, x, y: probe.y, shape: probe.shape };
}

/**
 * Every legal placement for `name` against `field`: all four rotations,
 * every column a hard drop from above could reach, each already validated
 * against `Field.collides` — nothing here duplicates collision logic.
 */
export function generatePlacements(field: Field, name: PieceName): Placement[] {
  const width = field.slots[0].length;
  const placements: Placement[] = [];
  for (let rotation = 0; rotation < 4; rotation++) {
    const shape = shapeAtOrientation(name, rotation as Orientation);
    const boxSize = shape.length;
    for (let x = -boxSize; x <= width; x++) {
      const placement = dropAt(field, name, shape, rotation as Orientation, x);
      if (placement) placements.push(placement);
    }
  }
  return placements;
}

/**
 * Resolve `placement` against a *clone* of `field` — the live field, its
 * piece queue, score and active piece are never touched.
 */
export function simulatePlacement(
  field: Field,
  name: PieceName,
  placement: Placement,
): { field: Field; result: PlaceResult } {
  const clone = field.clone();
  const piece = new Piece(name, placement.shape);
  piece.x = placement.x;
  piece.y = placement.y;
  const result = clone.placePiece(piece);
  return { field: clone, result };
}
