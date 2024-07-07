import P5 from 'p5'
import Tetris from '../../tetris/src'
import { getWindowSize } from './utils'
import { Piece } from '../../tetris/src/classes'

const CONTROLS: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowUp: 'rotate',
  Shift: 'hold',
  p: 'pause',
  ' ': 'push'
}

const SLOT_SIZE = 30
const SPEED_RATE = 20

const GAME = new Tetris({
  width: 10,
  height: 20
})

const colors = {
  O: [203, 222, 16],
  I: [35, 242, 232],
  J: [23, 12, 244],
  L: [254, 165, 10],
  S: [2, 245, 11],
  Z: [250, 10, 8],
  T: [132, 10, 145]
}

const strokeColor = 255

function getAdjustedSlotPosition(arg: number): number {
  return (-arg * SLOT_SIZE) / 2 + SLOT_SIZE / 2
}

function grid(
  rows: number,
  cols: number,
  callback: (rowIndex: number, cellIndex: number) => void
): void {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      callback(i, j)
    }
  }
}

const render = (el: HTMLElement): P5 => {
  let actionDelay = 0
  return new P5((p: P5) => {
    const drawFloor = (length: number): void => {
      Array.from({ length }, () => {
        p.fill(0, 0, 0, 0)
        p.translate(SLOT_SIZE, 0, 0)
        p.box(SLOT_SIZE, 1, SLOT_SIZE)
      })
    }

    const drawPiecePreview = (piece: Piece): void => {
      grid(4, 4, (i, j) => {
        p.push()
        if (piece.shape[i]?.[j]) {
          p.fill(...(colors[piece.name] as [number, number, number]), 255)
          p.translate((j * SLOT_SIZE) / 2, (i * SLOT_SIZE) / 2)
          p.box(SLOT_SIZE / 2)
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
      GAME.action(CONTROLS[e.key] as any)
      actionDelay = p.frameCount
    }

    p.keyReleased = (): void => {
      actionDelay = 0
    }

    p.draw = (): void => {
      if (p.keyIsPressed) {
        if (actionDelay === 0) actionDelay = p.frameCount
        const move = ['left', 'right', 'down'].includes(CONTROLS[p.key])

        if (move && p.frameCount - actionDelay > 15 && Math.floor(p.frameCount % 2) === 0) {
          GAME.action(CONTROLS[p.key] as any)
        }
      }

      if (Math.floor(p.frameCount) % SPEED_RATE === 0) {
        GAME.update()
      }

      p.orbitControl()
      p.ortho()
      p.background(0, 0, 0, 0)
      p.noStroke()
      p.stroke(strokeColor)

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
      // const highestIndex = GAME.field.slots.findIndex((row) => row.some((slot) => slot))
      // const highest = highestIndex !== -1 ? GAME.field.slots.length - highestIndex : 0
      // const newRotation = -(highest + 1) / 45 + p.PI / 12
      // const rotationX = p.lerp(currentRotationX, newRotation, 0.05)
      // currentRotationX = rotationX
      // p.rotateX(rotationX)
      p.translate(
        getAdjustedSlotPosition(GAME.field.slots[0].length),
        getAdjustedSlotPosition(GAME.field.slots.length)
      )

      p.push()

      p.translate(-SLOT_SIZE, SLOT_SIZE * GAME.field.slots.length - SLOT_SIZE / 2)

      drawFloor(GAME.field.slots[0].length)

      p.pop()

      grid(GAME.field.slots.length, GAME.field.slots[0].length, (i, j) => {
        let slot = GAME.field.slots[i][j]

        if (GAME.activePiece) {
          const activePiece = GAME.activePiece
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
        p.push()
        p.translate(j * SLOT_SIZE, i * SLOT_SIZE)

        if (slot === 0) p.translate(0, 0, -SLOT_SIZE)
        if (slot === 1) p.fill(255)
        else if (Object.keys(colors).includes(slot as string)) {
          p.fill(...(colors[slot] as [number, number, number]))
        } else {
          p.noFill()
          p.stroke(strokeColor)
        }

        if (slot !== 0) p.box(SLOT_SIZE)
        else p.box(SLOT_SIZE, SLOT_SIZE, 1)
        p.pop()
      })

      p.pop()
    }
  }, el)
}

export default render
