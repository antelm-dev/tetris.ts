import type { Piece, PieceName } from '../engine'

/** One filled square of a piece, in field coordinates. */
export interface Cell {
  col: number
  row: number
  name: PieceName
}

/** The filled cells of a piece, expanded out of its shape matrix. */
export function pieceCells(piece: Piece): Cell[] {
  const out: Cell[] = []
  piece.shape.forEach((r, i) =>
    r.forEach((c, j) => {
      if (c) out.push({ col: piece.x + j, row: piece.y + i, name: piece.name })
    })
  )
  return out
}

/** Average column/row of a set of cells — used to center effects. */
export function centroid(cells: Cell[]): { col: number; row: number } {
  const n = cells.length || 1
  let col = 0
  let row = 0
  for (const c of cells) {
    col += c.col
    row += c.row
  }
  return { col: col / n, row: row / n }
}
