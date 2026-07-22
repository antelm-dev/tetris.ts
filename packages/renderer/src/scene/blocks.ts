import type P5 from 'p5'
import { CELL, COLS, ROWS, cellToWorld } from '../core/geometry'
import type { RGB } from '../core/color'
import { GARBAGE_SHADE, INK, PALETTE } from '../config/themes'
import type { Field, Game, Piece } from '@tetris/engine'
import { pieceCells } from './cells'

/**
 * Everything the WEBGL board is made of: the block primitive, the well, the
 * locked field, the ghost, the active piece and the hold/next side panels.
 *
 * These read the *live* palette (see `config/themes.ts`), so a theme change
 * repaints the board on the next frame with no re-wiring.
 */

interface BlockOptions {
  alpha?: number
  /** Uniform scale, for spawn/rotate pops and the smaller panel previews. */
  sc?: number
  z?: number
}

export function drawBlock(p: P5, x: number, y: number, body: RGB, face: RGB, opts: BlockOptions = {}): void {
  const { alpha = 255, sc = 1, z = 0 } = opts
  const s = CELL * 0.92 * sc
  p.push()
  p.translate(x, y, z)
  p.specularMaterial(70)
  p.shininess(48)
  p.fill(body[0], body[1], body[2], alpha)
  p.box(s, s, CELL * 0.5 * sc)
  // Raised, brighter cap fakes a soft bevel that catches the key light.
  p.push()
  p.translate(0, 0, CELL * 0.26 * sc)
  p.fill(face[0], face[1], face[2], alpha)
  p.box(s * 0.76, s * 0.76, CELL * 0.14 * sc)
  p.pop()
  p.pop()
}

/**
 * A glowing rectangular bezel frame around a `w`×`h` region centred at the
 * current origin: four bars raised off the backplate, catching the key light.
 * Shared by the well and the hold/next preview panels so their chrome reads
 * as one system.
 */
function drawBezel(p: P5, w: number, h: number, thickness: number, depth: number, color: RGB): void {
  p.push()
  p.noStroke()
  p.specularMaterial(120)
  p.shininess(80)
  p.fill(color[0], color[1], color[2])
  const bar = (bx: number, by: number, bw: number, bh: number): void => {
    p.push()
    p.translate(bx, by, 0)
    p.box(bw, bh, depth)
    p.pop()
  }
  bar(0, -h / 2 - thickness / 2, w + thickness * 2, thickness)
  bar(0, h / 2 + thickness / 2, w + thickness * 2, thickness)
  bar(-w / 2 - thickness / 2, 0, thickness, h + thickness * 2)
  bar(w / 2 + thickness / 2, 0, thickness, h + thickness * 2)
  p.pop()
}

export function drawWell(p: P5): void {
  const w = COLS * CELL
  const h = ROWS * CELL
  // Recessed backplate.
  p.push()
  p.noStroke()
  p.translate(0, 0, -CELL * 0.55)
  p.fill(...INK.wellFill)
  p.box(w + CELL * 0.5, h + CELL * 0.5, CELL * 0.4)
  p.pop()

  // Faint interior grid.
  p.push()
  p.translate(0, 0, -CELL * 0.32)
  p.stroke(INK.grid[0], INK.grid[1], INK.grid[2], 150)
  p.strokeWeight(1)
  for (let c = 0; c <= COLS; c++) {
    const x = (c - COLS / 2) * CELL
    p.line(x, -h / 2, 0, x, h / 2, 0)
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = (r - ROWS / 2) * CELL
    p.line(-w / 2, y, 0, w / 2, y, 0)
  }
  p.pop()

  drawBezel(p, w, h, CELL * 0.34, CELL * 0.6, INK.wellEdge)
}

export function drawLockedField(p: P5, field: Field): void {
  const slots = field.slots
  for (let i = 0; i < slots.length; i++) {
    for (let j = 0; j < slots[i].length; j++) {
      const slot = slots[i][j]
      if (slot === 0) continue
      const { x, y } = cellToWorld(j, i)
      const pal = slot === 'GARBAGE' ? GARBAGE_SHADE : PALETTE[slot]
      drawBlock(p, x, y, pal.body, pal.face)
    }
  }
}

/** The landing preview: where the active piece would come to rest right now. */
export function drawGhost(p: P5, game: Game, visualX: number): void {
  const ap = game.activePiece
  if (!ap) return
  const g = ap.clone()
  while (!game.field.checkCollision(g, 'down')) g.move('down')
  if (g.y <= ap.y) return // already resting — no ghost needed
  const pal = PALETTE[ap.name]
  p.push()
  p.noStroke()
  p.blendMode(p.ADD)
  for (const cell of pieceCells(g)) {
    // Ghost x follows the eased visual column so it slides with the piece.
    const { x, y } = cellToWorld(cell.col - ap.x + visualX, cell.row)
    p.push()
    p.translate(x, y, 0)
    p.fill(pal.glow[0], pal.glow[1], pal.glow[2], 45)
    p.box(CELL * 0.86, CELL * 0.86, CELL * 0.14)
    p.pop()
  }
  p.blendMode(p.BLEND)
  p.pop()
}

/**
 * The falling piece, drawn at its *interpolated* position rather than its grid
 * one — `visualX`/`visualY` chase the engine's integer cell, and `pop` is the
 * spawn/rotate scale bump (see `app/loop.ts`).
 */
export function drawActive(p: P5, game: Game, visualX: number, visualY: number, pop: number): void {
  const ap = game.activePiece
  if (!ap) return
  const pal = PALETTE[ap.name]
  for (const cell of pieceCells(ap)) {
    const { x, y } = cellToWorld(cell.col - ap.x + visualX, cell.row - ap.y + visualY)
    drawBlock(p, x, y, pal.body, pal.face, { sc: pop, z: 2 })
  }
}

/** A hold / next-queue preview panel: a framed square with a piece in it. */
export function drawPanel(p: P5, piece: Piece | undefined, centerX: number, centerY: number): void {
  const size = CELL * 3.4

  // Recessed backplate, matching the well's.
  p.push()
  p.translate(centerX, centerY, -CELL * 0.42)
  p.noStroke()
  p.fill(...INK.wellFill)
  p.box(size, size, CELL * 0.3)
  p.pop()

  p.push()
  p.translate(centerX, centerY, 0)
  drawBezel(p, size, size, CELL * 0.12, CELL * 0.22, INK.wellEdge)
  p.pop()

  if (!piece) return
  const pal = PALETTE[piece.name]
  const s = 0.62
  // Centre on the piece's *filled* cells, not on its bounding box: the box is
  // square and padded (an I is four cells in a 4×4), so centring on it would
  // hang every preview off to one side of its frame.
  const filled: [number, number][] = []
  piece.shape.forEach((r, i) =>
    r.forEach((c, j) => {
      if (c) filled.push([j, i])
    })
  )
  const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2
  const midX = mid(filled.map(([j]) => j))
  const midY = mid(filled.map(([, i]) => i))
  for (const [j, i] of filled) {
    const x = centerX + (j - midX) * CELL * s
    const y = centerY + (i - midY) * CELL * s
    drawBlock(p, x, y, pal.body, pal.face, { sc: s })
  }
}
