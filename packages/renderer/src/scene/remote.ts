import type P5 from 'p5'
import { Piece, PIECES_SHAPES, type Orientation, type PieceName } from '@tetris/engine'
import type { WireActivePiece, WireSlot } from '@tetris/protocol'
import { cellToWorld } from '../core/geometry'
import { GARBAGE_SHADE, PALETTE } from '../config/themes'
import { pieceCells } from './cells'
import { drawBlock } from './blocks'

/**
 * Display-only drawers for an opponent {@link RemoteProjection} / wire snapshot.
 * These never touch a `Game` or `Field` — remote state is not locally simulated.
 */

/** Reconstruct a `Piece` at the wire orientation so existing cell helpers can draw it. */
export function pieceFromWire(ap: WireActivePiece): Piece {
  const piece = new Piece(ap.name, PIECES_SHAPES[ap.name as PieceName])
  piece.x = ap.x
  piece.y = ap.y
  const turns = ap.orientation as Orientation
  for (let i = 0; i < turns; i++) piece.rotate('right')
  return piece
}

/** Draw a full-height wire board (row-major {@link WireSlot} grid). */
export function drawWireBoard(p: P5, board: WireSlot[][]): void {
  for (let i = 0; i < board.length; i++) {
    const row = board[i]
    for (let j = 0; j < row.length; j++) {
      const slot = row[j]
      if (slot === 0) continue
      const { x, y } = cellToWorld(j, i)
      const pal = slot === 'GARBAGE' ? GARBAGE_SHADE : PALETTE[slot]
      drawBlock(p, x, y, pal.body, pal.face)
    }
  }
}

/** Draw a wire active piece at its grid position (no local motion easing). */
export function drawWireActive(p: P5, active?: WireActivePiece): void {
  if (!active) return
  const piece = pieceFromWire(active)
  const pal = PALETTE[piece.name]
  for (const cell of pieceCells(piece)) {
    const { x, y } = cellToWorld(cell.col, cell.row)
    drawBlock(p, x, y, pal.body, pal.face, { z: 2 })
  }
}

/** Convenience: well chrome is shared; callers compose board + optional active piece. */
export function drawRemoteProjection(p: P5, board: WireSlot[][], active?: WireActivePiece): void {
  drawWireBoard(p, board)
  drawWireActive(p, active)
}
