import { COLS, ROWS } from '@tetris/engine'

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

/**
 * World-space X of the hold/next side panels (mirrored for the hold panel on
 * the left). Shared by `sketch.ts` (which draws the WEBGL panels) and the 2D
 * HUD (which labels them), so the two never drift apart.
 */
export function sidePanelX(): number {
  return (COLS / 2 + 3) * CELL
}

/** World-space Y of the top-most side panel. */
export function sidePanelTop(): number {
  return -(ROWS / 2 - 2) * CELL
}
