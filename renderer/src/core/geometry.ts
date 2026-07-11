import { COLS, ROWS } from '../engine'

export { COLS, ROWS }

/** Edge length of a single cell, in world units (~pixels before the fit-scale). */
export const CELL = 34

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
