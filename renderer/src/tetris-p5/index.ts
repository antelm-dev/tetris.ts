import P5 from 'p5'
import { getWindowSize } from './utils'
import { Effects } from './effects'
import { Background } from './background'
import { Input } from './input'
import { CELL, COLS, ROWS, PALETTE, INK, cellToWorld, type RGB } from './theme'
import { Game, type Piece, type PieceName } from '../tetris'

const GAME = new Game({ width: COLS, height: ROWS })

/** Milliseconds a piece takes to fall one cell at a given level. */
function gravityInterval(level: number): number {
  return Math.max(70, 800 * Math.pow(0.82, level - 1))
}

/** Frame-rate-independent smoothing factor for an exponential ease. */
function easeK(dt: number, rate: number): number {
  return 1 - Math.exp(-dt * rate)
}

interface Cell {
  col: number
  row: number
  name: PieceName
}

function pieceCells(piece: Piece): Cell[] {
  const out: Cell[] = []
  piece.shape.forEach((r, i) =>
    r.forEach((c, j) => {
      if (c) out.push({ col: piece.x + j, row: piece.y + i, name: piece.name })
    })
  )
  return out
}

/** Average column/row of a set of cells — used to center effects. */
function centroid(cells: Cell[]): { col: number; row: number } {
  const n = cells.length || 1
  let col = 0
  let row = 0
  for (const c of cells) {
    col += c.col
    row += c.row
  }
  return { col: col / n, row: row / n }
}

export interface RenderHooks {
  onScore?: (score: number) => void
  onLines?: (lines: number) => void
  onLevel?: (level: number) => void
  onGameOver?: (score: number) => void
  onRestart?: () => void
  onPause?: (paused: boolean) => void
}

const render = (el: HTMLElement, hooks: RenderHooks = {}): P5 => {
  const fx = new Effects()
  const bg = new Background()
  const input = new Input(GAME)

  // Interpolated visual state for the active piece (decoupled from grid steps).
  let visualX = 0
  let visualY = 0
  let lastPiece: Piece | undefined
  let spawnPulse = 0
  let rotatePulse = 0
  let gravAcc = 0
  const lockFlashes: { cells: Cell[]; t: number }[] = []
  const clearFlashes: { row: number; t: number }[] = []

  return new P5((p: P5) => {
    // --- block primitive -----------------------------------------------------
    const drawBlock = (
      x: number,
      y: number,
      body: RGB,
      face: RGB,
      opts: { alpha?: number; sc?: number; z?: number } = {}
    ): void => {
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

    const drawWell = (): void => {
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

      // Glowing frame bezel.
      p.push()
      p.noStroke()
      p.specularMaterial(120)
      p.shininess(80)
      p.fill(...INK.wellEdge)
      const t = CELL * 0.34
      const bar = (bx: number, by: number, bw: number, bh: number): void => {
        p.push()
        p.translate(bx, by, 0)
        p.box(bw, bh, CELL * 0.6)
        p.pop()
      }
      bar(0, -h / 2 - t / 2, w + t * 2, t)
      bar(0, h / 2 + t / 2, w + t * 2, t)
      bar(-w / 2 - t / 2, 0, t, h + t * 2)
      bar(w / 2 + t / 2, 0, t, h + t * 2)
      p.pop()
    }

    const drawLockedField = (): void => {
      const slots = GAME.field.slots
      for (let i = 0; i < slots.length; i++) {
        for (let j = 0; j < slots[i].length; j++) {
          const slot = slots[i][j]
          if (slot === 0) continue
          const { x, y } = cellToWorld(j, i)
          const pal = PALETTE[slot]
          drawBlock(x, y, pal.body, pal.face)
        }
      }
    }

    const drawGhost = (): void => {
      const ap = GAME.activePiece
      if (!ap) return
      const g = ap.clone()
      while (!GAME.field.checkCollision(g, 'down')) g.move('down')
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

    const drawActive = (): void => {
      const ap = GAME.activePiece
      if (!ap) return
      const pal = PALETTE[ap.name]
      const pop = 1 + spawnPulse * 0.16 + rotatePulse * 0.12
      for (const cell of pieceCells(ap)) {
        const { x, y } = cellToWorld(cell.col - ap.x + visualX, cell.row - ap.y + visualY)
        drawBlock(x, y, pal.body, pal.face, { sc: pop, z: 2 })
      }
    }

    const drawPanel = (
      piece: Piece | undefined,
      centerX: number,
      centerY: number
    ): void => {
      // Frame.
      p.push()
      p.translate(centerX, centerY, -CELL * 0.3)
      p.noFill()
      p.stroke(INK.wellEdge[0], INK.wellEdge[1], INK.wellEdge[2], 120)
      p.strokeWeight(1.5)
      p.plane(CELL * 3.4, CELL * 3.4)
      p.pop()
      if (!piece) return
      const pal = PALETTE[piece.name]
      const rows = piece.shape.length
      const cols = piece.shape[0].length
      const s = 0.62
      piece.shape.forEach((r, i) =>
        r.forEach((c, j) => {
          if (!c) return
          const x = centerX + (j - (cols - 1) / 2) * CELL * s
          const y = centerY + (i - (rows - 1) / 2) * CELL * s
          drawBlock(x, y, pal.body, pal.face, { sc: s })
        })
      )
    }

    const drawFlashes = (): void => {
      if (lockFlashes.length === 0 && clearFlashes.length === 0) return
      p.push()
      p.noStroke()
      p.blendMode(p.ADD)
      for (const lf of lockFlashes) {
        for (const cell of lf.cells) {
          const { x, y } = cellToWorld(cell.col, cell.row)
          p.push()
          p.translate(x, y, 4)
          p.fill(255, 255, 255, 200 * lf.t)
          p.box(CELL * 0.92, CELL * 0.92, CELL * 0.5)
          p.pop()
        }
      }
      for (const cf of clearFlashes) {
        const { y } = cellToWorld(0, cf.row)
        p.push()
        p.translate(0, y, 6)
        p.fill(255, 255, 255, 230 * cf.t)
        p.box(COLS * CELL * (0.6 + cf.t * 0.5), CELL * (0.4 + cf.t * 0.8), CELL * 0.3)
        p.pop()
      }
      p.blendMode(p.BLEND)
      p.pop()
    }

    // --- engine event wiring -------------------------------------------------
    const wireEvents = (): void => {
      GAME.events = {
        onSpawn: () => {
          spawnPulse = 1
        },
        onRotate: () => {
          rotatePulse = 1
        },
        onSpin: (name) => {
          // Extra flourish for a spin: a bright pop plus a spark burst centered
          // on the piece, so a tucked T-spin / L-spin reads as a special move.
          const ap = GAME.activePiece
          rotatePulse = 1.4
          if (ap) {
            const c = centroid(pieceCells(ap))
            const { x, y } = cellToWorld(c.col, c.row)
            fx.burst(x, y, 18, PALETTE[name].glow, 300)
          }
          fx.shake(0.4)
        },
        onLock: (hard) => {
          const ap = GAME.activePiece
          if (ap) {
            const cells = pieceCells(ap)
            lockFlashes.push({ cells, t: 1 })
            const bottom = cells.reduce((m, c) => Math.max(m, c.row), 0)
            const { x, y } = cellToWorld(centroid(cells).col, bottom)
            fx.burst(x, y, hard ? 22 : 10, PALETTE[ap.name].glow, hard ? 260 : 150)
          }
          fx.shake(hard ? 0.5 : 0.22)
        },
        onClear: (rows, count, level) => {
          for (const r of rows) {
            clearFlashes.push({ row: r, t: 1 })
            const { y } = cellToWorld(0, r)
            const tint = count >= 4 ? [255, 230, 120] : [180, 240, 255]
            fx.line(y, (COLS * CELL) / 2, tint as RGB, 40 + count * 8)
          }
          fx.shake(0.3 + count * 0.14)
          hooks.onScore?.(GAME.score)
          hooks.onLines?.(GAME.lines)
          hooks.onLevel?.(level)
        },
        onLevelUp: (level) => hooks.onLevel?.(level),
        onGameOver: (score) => {
          fx.shake(0.8)
          hooks.onGameOver?.(score)
        },
        onPause: (paused) => hooks.onPause?.(paused),
        onStart: () => {
          gravAcc = 0
          lockFlashes.length = 0
          clearFlashes.length = 0
          hooks.onScore?.(0)
          hooks.onLines?.(0)
          hooks.onLevel?.(1)
          hooks.onRestart?.()
        }
      }
    }

    // --- p5 lifecycle --------------------------------------------------------
    p.windowResized = (): void => {
      const size = getWindowSize()
      p.resizeCanvas(size.width, size.height, true)
    }

    p.setup = (): void => {
      const size = getWindowSize()
      p.frameRate(60)
      p.createCanvas(size.width, size.height, p.WEBGL)
      p.setAttributes('antialias', true)
      wireEvents()
      input.attach()
      GAME.update() // spawn the first piece immediately (no blank start)
    }

    const fitScale = (): number => {
      const contentW = (COLS + 12) * CELL
      const contentH = (ROWS + 3) * CELL
      return Math.min(p.width / contentW, p.height / contentH) * 0.96
    }

    p.draw = (): void => {
      const dt = Math.min(p.deltaTime / 1000, 0.05)

      // 1. Input auto-repeat + gravity, both on real-time clocks.
      input.update(dt)
      if (!GAME.isPaused && !GAME.gameOver) {
        const interval = gravityInterval(GAME.level)
        gravAcc += dt * 1000
        let steps = 0
        while (gravAcc >= interval && steps < 6) {
          gravAcc -= interval
          GAME.update()
          steps++
        }
      }

      // 2. Track the active piece for interpolation / pop animations.
      const ap = GAME.activePiece
      if (ap) {
        if (ap !== lastPiece) {
          visualX = ap.x
          visualY = ap.y
          lastPiece = ap
        }
        visualX += (ap.x - visualX) * easeK(dt, 30)
        visualY += (ap.y - visualY) * easeK(dt, 26)
      } else {
        lastPiece = undefined
      }

      // 3. Advance juice timers.
      spawnPulse = Math.max(0, spawnPulse - dt * 4)
      rotatePulse = Math.max(0, rotatePulse - dt * 6)
      for (const f of lockFlashes) f.t -= dt * 5.5
      for (const f of clearFlashes) f.t -= dt * 3
      if (lockFlashes.length) lockFlashes.splice(0, lockFlashes.length, ...lockFlashes.filter((f) => f.t > 0))
      if (clearFlashes.length)
        clearFlashes.splice(0, clearFlashes.length, ...clearFlashes.filter((f) => f.t > 0))
      fx.update(dt)
      bg.setLevel(GAME.level)
      bg.update(dt)

      // 4. Render.
      const w = p.width
      const h = p.height
      const sway = Math.sin(p.frameCount * 0.006) * 0.03
      p.ortho(-w / 2, w / 2, -h / 2, h / 2, -3000, 3000)
      const clear = bg.clearColor()
      p.background(clear[0], clear[1], clear[2])

      // Evolving backdrop — drawn first, while no lights are active, so its
      // unlit fills render at their literal colours. Shares the camera tilt for
      // a touch of parallax but drifts on its own for a calmer, distant feel.
      p.push()
      fx.applyShake(p)
      p.scale(fitScale())
      p.rotateX(-0.13)
      p.rotateY(sway)
      bg.draw(p)
      p.pop()

      // Lighting (applied after the backdrop so it never dims it).
      p.ambientLight(58, 62, 82)
      p.directionalLight(255, 252, 245, -0.35, -0.55, -0.72)
      p.pointLight(90, 130, 235, -260, -360, 520)
      p.pointLight(60, 60, 90, 320, 340, 420)

      p.push()
      fx.applyShake(p)
      p.scale(fitScale())
      // Subtle fixed tilt + slow sway for a living, 3D feel (no free orbit).
      p.rotateX(-0.13)
      p.rotateY(sway)

      drawWell()
      drawLockedField()
      drawGhost()
      drawActive()
      drawFlashes()

      // Side panels: hold (left) and the next queue (right, top-down).
      const px = (COLS / 2 + 3) * CELL
      drawPanel(GAME.holdPiece, -px, -(ROWS / 2 - 2) * CELL)
      const next = GAME.nextPieces.slice(-3).reverse()
      next.forEach((piece, i) => {
        drawPanel(piece, px, -(ROWS / 2 - 2) * CELL + i * CELL * 3.4)
      })

      fx.draw(p)
      p.pop()
    }
  }, el)
}

export default render
