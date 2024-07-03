import P5 from 'p5'
import { getWindowSize } from './utils'
import Game from '../../../packages/tetris/src'

const CONTROLS: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowUp: 'rotate',
  ' ': 'push',
  p: 'pause',
  Shift: 'hold'
}

const SLOT_SIZE = 30
const SPEED_RATE = 8
const GAME = new Game({
  width: 10,
  height: 20
})

function getAdjustedSlotPosition(arg: number): number {
  return (-arg * SLOT_SIZE) / 2 + SLOT_SIZE / 2
}

const App = (el: HTMLElement): P5 => {
  let currentAction: string | null = null
  let currentRotationX = 0
  return new P5((p: P5) => {
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
      const move = ['left', 'right', 'down'].includes(CONTROLS[e.key])
      if (move) currentAction = CONTROLS[e.key]
      else GAME.action(CONTROLS[e.key] as any)
    }

    p.keyReleased = (): void => {
      currentAction = null
    }

    p.draw = (): void => {
      p.background(0, 0, 0, 0)
      p.directionalLight(255, 255, 255, 0, -0.5, -2)
      p.noStroke()
      p.stroke(255)

      let highest = 0

      for (let i = 0; i < GAME.field.slots.length; i++) {
        if (GAME.field.slots[i].some((slot) => slot)) {
          highest = GAME.field.slots.length - i
          break
        }
      }
      const newRotation = -(highest + 1) / 30 + p.PI / 10

      const rotationX = p.lerp(currentRotationX, newRotation, 0.1)
      currentRotationX = rotationX
      p.rotateX(rotationX)
      p.translate(
        getAdjustedSlotPosition(GAME.field.slots[0].length),
        getAdjustedSlotPosition(GAME.field.slots.length)
      )
      if (currentAction && Math.floor(p.frameCount % 2) === 0) {
        GAME.action(currentAction as any)
      }

      if (Math.floor(p.frameCount) % SPEED_RATE === 0) {
        GAME.update()
      }

      p.push()

      p.translate(-SLOT_SIZE, GAME.field.slots.length * SLOT_SIZE + -SLOT_SIZE / 2, 0)

      Array.from({ length: GAME.field.slots[0].length }, (_, y) => {
        p.fill(0, 0, 0, 0)
        p.translate(SLOT_SIZE, 0, 0)
        p.box(SLOT_SIZE, 1, SLOT_SIZE)
      })

      p.pop()

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
              activePiece.shape[localI][localJ] === 1
            ) {
              slot = activePiece.name
            }
          }

          p.push()
          p.translate(j * SLOT_SIZE, i * SLOT_SIZE)
          if (slot === 0) p.translate(0, 0, -SLOT_SIZE)
          if (slot === 1) p.fill(255)
          else {
            switch (slot) {
              case 'I':
                p.fill(0, 255, 255)
                break
              case 'J':
                p.fill(0, 0, 255)
                break
              case 'L':
                p.fill(255, 165, 0)
                break
              case 'O':
                p.fill(255, 255, 0)
                break
              case 'S':
                p.fill(0, 255, 0)
                break
              case 'T':
                p.fill(128, 0, 128)
                break
              case 'Z':
                p.fill(255, 0, 0)
                break
              default:
                p.fill(0, 0, 0, 0)
                p.stroke(255)
            }
          }
          if (slot !== 0) p.box(SLOT_SIZE)
          else p.box(SLOT_SIZE, SLOT_SIZE, 1)
          p.pop()
        }
      }
    }
  }, el)
}

window.addEventListener('DOMContentLoaded', async () => {
  App(document.getElementById('root')!)
})
