import P5 from 'p5'
import { getWindowSize } from './utils'
import { Game, type Action, type PieceName, type Slot } from '../tetris'

const CONTROLS: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  z: 'rotate-right',
  x: 'rotate-left',
  Shift: 'hold',
  p: 'pause',
  ' ': 'push'
}

const SLOT_SIZE = 30
const SPEED_RATE = 20

const GAME = new Game({
  width: 10,
  height: 20
})

const COLORS: Record<PieceName, [number, number, number]> = {
  O: [203, 222, 16],
  I: [35, 242, 232],
  J: [23, 12, 244],
  L: [254, 165, 10],
  S: [2, 245, 11],
  Z: [250, 10, 8],
  T: [132, 10, 145]
}

const STROKE_COLOR = 255

function getAdjustedSlotPosition(arg: number) {
  return (-arg * SLOT_SIZE) / 2 + SLOT_SIZE / 2
}

function grid(rows: number, cols: number, callback: (row: number, col: number) => void): void {
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) callback(i, j)
}

function getSlot(i: number, j: number): Slot {
  let slot: Slot = GAME.field.slots[i][j]

  if (GAME.activePiece) {
    const { activePiece } = GAME
    const localI = i - activePiece.y
    const localJ = j - activePiece.x

    if (
      localI >= 0 &&
      localI < activePiece.shape.length &&
      localJ >= 0 &&
      localJ < activePiece.shape[localI].length &&
      activePiece.shape[localI][localJ]
    ) {
      slot = activePiece.name
    }
  }
  return slot
}

export interface RenderHooks {
  /** Called whenever the score changes. */
  onScore?: (score: number) => void
  /** Called once each time the game transitions into game-over. */
  onGameOver?: (score: number) => void
}

const render = (el: HTMLElement, hooks: RenderHooks = {}): P5 => {
  let actionDelay = 0
  let lastScore = -1
  let wasGameOver = false
  return new P5((p: P5) => {
    const drawWall = (length: number): void => {
      Array.from({ length }, () => {
        p.fill(0, 0, 0, 0)
        p.translate(SLOT_SIZE, 0, 0)
        p.box(SLOT_SIZE, 1, SLOT_SIZE)
      })
    }

    const drawPiecePreview = (piece: { name: PieceName; shape: number[][] }): void => {
      grid(4, 4, (i, j) => {
        p.push()
        if (piece.shape[i]?.[j]) {
          p.fill(...COLORS[piece.name], 255)
          p.translate((j * SLOT_SIZE) / 2, (i * SLOT_SIZE) / 2)
          p.box(SLOT_SIZE / 2)
        }
        p.pop()
      })
    }

    const drawField = (): void => {
      grid(GAME.field.slots.length, GAME.field.slots[0].length, (i, j) => {
        const slot = getSlot(i, j)
        p.push()
        p.translate(j * SLOT_SIZE, i * SLOT_SIZE)

        if (slot === 0) {
          p.translate(0, 0, -SLOT_SIZE)
          p.noFill()
          p.stroke(STROKE_COLOR)
          p.box(SLOT_SIZE, SLOT_SIZE, 1)
        } else {
          p.fill(...COLORS[slot])
          p.box(SLOT_SIZE)
        }

        p.pop()
      })
    }

    p.windowResized = (): void => {
      const size = getWindowSize()
      p.resizeCanvas(size.width, size.height, true)
    }

    p.setup = (): void => {
      const size = getWindowSize()
      p.frameRate(60)
      p.createCanvas(size.width, size.height, p.WEBGL)
    }

    p.keyPressed = (e: KeyboardEvent): void => {
      const action = CONTROLS[e.key]
      if (action) GAME.action(action)
      actionDelay = p.frameCount
    }

    p.keyReleased = (): void => {
      actionDelay = 0
    }

    p.draw = (): void => {
      if (p.keyIsPressed) {
        if (actionDelay === 0) actionDelay = p.frameCount
        const action = CONTROLS[p.key]
        const move = action === 'left' || action === 'right' || action === 'down'

        if (move && p.frameCount - actionDelay > 15 && Math.floor(p.frameCount % 2) === 0) {
          GAME.action(action)
        }
      }

      if (Math.floor(p.frameCount) % SPEED_RATE === 0) {
        GAME.update()
      }

      if (GAME.score !== lastScore) {
        lastScore = GAME.score
        hooks.onScore?.(GAME.score)
      }

      if (GAME.gameOver && !wasGameOver) hooks.onGameOver?.(GAME.score)
      wasGameOver = GAME.gameOver

      p.orbitControl()
      p.ortho()
      p.background(0, 0, 0, 0)
      p.noStroke()
      p.stroke(STROKE_COLOR)

      p.push()
      p.translate(SLOT_SIZE * 6, SLOT_SIZE * 2.3, 0)

      for (const piece of GAME.nextPieces) {
        p.translate(0, -SLOT_SIZE * 3, 0)
        drawPiecePreview(piece)
      }

      p.pop()

      p.push()
      p.translate(-SLOT_SIZE * 7, -SLOT_SIZE * 10 + SLOT_SIZE / 4, 0)
      if (GAME.holdPiece) drawPiecePreview(GAME.holdPiece)

      p.pop()

      p.push()
      p.translate(
        getAdjustedSlotPosition(GAME.field.slots[0].length),
        getAdjustedSlotPosition(GAME.field.slots.length)
      )

      p.push()

      p.translate(-SLOT_SIZE, SLOT_SIZE * GAME.field.slots.length - SLOT_SIZE / 2)

      drawWall(GAME.field.slots[0].length)

      p.pop()

      drawField()

      p.pop()
    }
  }, el)
}

export default render
