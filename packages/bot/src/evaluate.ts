import type { Field } from '@tetris/engine'

/** Height of every column — the row index of its topmost filled cell, from the floor. */
export function columnHeights(field: Field): number[] {
  const slots = field.slots
  const height = slots.length
  const width = slots[0].length
  const heights = new Array<number>(width).fill(0)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (slots[y][x] !== 0) {
        heights[x] = height - y
        break
      }
    }
  }
  return heights
}

/** Sum of every column's height. */
export function aggregateHeight(field: Field): number {
  return columnHeights(field).reduce((a, b) => a + b, 0)
}

/** The tallest column. */
export function maxHeight(field: Field): number {
  return Math.max(0, ...columnHeights(field))
}

/** Empty cells with a filled cell somewhere above them, summed over every column. */
export function countHoles(field: Field): number {
  const slots = field.slots
  const width = slots[0].length
  let holes = 0
  for (let x = 0; x < width; x++) {
    let seenFilled = false
    for (let y = 0; y < slots.length; y++) {
      const filled = slots[y][x] !== 0
      if (filled) seenFilled = true
      else if (seenFilled) holes++
    }
  }
  return holes
}

/** Sum of the absolute height difference between every pair of adjacent columns. */
export function bumpiness(field: Field): number {
  const heights = columnHeights(field)
  let total = 0
  for (let x = 0; x < heights.length - 1; x++) total += Math.abs(heights[x] - heights[x + 1])
  return total
}

/**
 * Sum of "well" depth: how far a column sits below both neighbors (edge
 * columns are compared only to their one neighbor). Deep wells are only
 * safely fillable by an I piece, so they're penalized on their own, distinct
 * from plain bumpiness.
 */
export function wells(field: Field): number {
  const heights = columnHeights(field)
  let total = 0
  for (let x = 0; x < heights.length; x++) {
    const left = x > 0 ? heights[x - 1] : Infinity
    const right = x < heights.length - 1 ? heights[x + 1] : Infinity
    const depth = Math.min(left, right) - heights[x]
    if (depth > 0 && Number.isFinite(depth)) total += depth
  }
  return total
}

/** Height, past which every extra row is treated as materially more dangerous. */
const DANGER_HEIGHT = 12

const WEIGHTS = {
  linesCleared: 4,
  aggregateHeight: -0.5,
  holes: -3.2,
  bumpiness: -0.32,
  maxHeight: -0.6,
  dangerHeight: -1.4,
  wells: -0.4
}

/**
 * A single score for a resulting board — higher is better. Strongly
 * penalizes holes and, once the stack passes {@link DANGER_HEIGHT}, extra
 * height on top of the baseline penalty every row already carries.
 */
export function evaluateField(field: Field, clearedLines: number): number {
  const heights = columnHeights(field)
  const tallest = Math.max(0, ...heights)
  const danger = Math.max(0, tallest - DANGER_HEIGHT)
  return (
    WEIGHTS.linesCleared * clearedLines +
    WEIGHTS.aggregateHeight * heights.reduce((a, b) => a + b, 0) +
    WEIGHTS.holes * countHoles(field) +
    WEIGHTS.bumpiness * bumpiness(field) +
    WEIGHTS.maxHeight * tallest +
    WEIGHTS.dangerHeight * danger +
    WEIGHTS.wells * wells(field)
  )
}
