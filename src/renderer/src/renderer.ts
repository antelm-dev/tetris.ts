import P5 from 'p5'
import { getWindowSize } from './utils'
import Tetris from '../../../packages/tetris/src'

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
const SPEED_RATE = 8

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

function getAdjustedSlotPosition(arg: number): number {
  return (-arg * SLOT_SIZE) / 2 + SLOT_SIZE / 2
}

function compute(
  callback: (slot: string | number, rowIndex: number, cellIndex: number) => void
): void {
  for (let i = 0; i < GAME.field.slots.length; i++) {
    for (let j = 0; j < GAME.field.slots[i].length; j++) {
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

      callback(slot, i, j)
    }
  }
}

const render = (el: HTMLElement): P5 => {
  let currentRotationX = 0
  let actionDelay = 0
  return new P5((p: P5) => {
    const createFloor = (length: number): void => {
      Array.from({ length }, () => {
        p.fill(0, 0, 0, 0)
        p.translate(SLOT_SIZE, 0, 0)
        p.box(SLOT_SIZE, 1, SLOT_SIZE)
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
      p.orbitControl()

      p.background(0, 0, 0, 0)
      p.noStroke()
      p.stroke(255)

      const highestIndex = GAME.field.slots.findIndex((row) => row.some((slot) => slot))
      const highest = highestIndex !== -1 ? GAME.field.slots.length - highestIndex : 0
      const newRotation = -(highest + 1) / 45 + p.PI / 12
      const rotationX = p.lerp(currentRotationX, newRotation, 0.05)
      currentRotationX = rotationX

      p.rotateX(rotationX)
      p.translate(
        getAdjustedSlotPosition(GAME.field.slots[0].length),
        getAdjustedSlotPosition(GAME.field.slots.length)
      )

      if (Math.floor(p.frameCount) % SPEED_RATE === 0) {
        GAME.update()
      }

      p.push()

      p.translate(-SLOT_SIZE, GAME.field.slots.length * SLOT_SIZE + -SLOT_SIZE / 2, 0)

      createFloor(GAME.field.slots[0].length)

      p.pop()

      if (p.keyIsPressed) {
        if (actionDelay === 0) actionDelay = p.frameCount
        const move = ['left', 'right', 'down'].includes(CONTROLS[p.key])

        if (move && p.frameCount - actionDelay > 15 && Math.floor(p.frameCount % 2) === 0) {
          GAME.action(CONTROLS[p.key] as any)
        }
      }

      compute((slot, i, j) => {
        p.push()
        p.translate(j * SLOT_SIZE, i * SLOT_SIZE)

        if (slot === 0) p.translate(0, 0, -SLOT_SIZE)

        if (slot === 1) p.fill(255)
        else if (Object.keys(colors).includes(slot as string)) {
          const [r, g, b] = colors[slot]
          p.fill(r, g, b)
        } else {
          p.fill(0, 0, 0, 0)
          p.stroke(255)
        }

        if (slot !== 0) p.box(SLOT_SIZE)
        else p.box(SLOT_SIZE, SLOT_SIZE, 1)
        p.pop()
      })
    }
  }, el)
}

window.addEventListener('DOMContentLoaded', async () => {
  render(document.getElementById('root')!)
})
