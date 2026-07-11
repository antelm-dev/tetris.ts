import P5 from 'p5'
import { getWindowSize } from '../core/dom'
import { CELL, COLS, ROWS } from '../core/geometry'
import { Game } from '../engine'
import { Input } from '../input/Input'
import { Menu } from '../hud/Menu'
import { Ui } from '../hud/Ui'
import { Background } from '../scene/background'
import { Effects } from '../scene/effects'
import { Flashes } from '../scene/flashes'
import { applyLights, applyProjection, inWorld, sway } from '../scene/camera'
import { drawActive, drawGhost, drawLockedField, drawPanel, drawWell } from '../scene/blocks'
import { wireEvents } from './events'
import { Gravity, PieceMotion } from './loop'
import type { HighScores, Host } from './host'

/**
 * The composition root: owns the engine and every presentation object, wires
 * them together, and drives the p5 lifecycle. It decides *when* things happen —
 * the drawing itself lives in `scene/`, the chrome in `hud/`, and the mapping
 * from engine events to visuals in `events.ts`.
 */

/**
 * What the sketch is currently showing. In `menu` the board is still drawn and
 * animating — it just doesn't tick — so the menu sits over a living scene and
 * a theme change previews itself on the well behind the card.
 */
type Scene = 'menu' | 'play'

const render = (el: HTMLElement, scores?: HighScores, host?: Host): P5 => {
  // Every piece of state the sketch owns is built here, so a second canvas gets
  // its own engine rather than sharing one through the module.
  const game = new Game({ width: COLS, height: ROWS })
  const fx = new Effects()
  const bg = new Background()
  const ui = new Ui()
  const flashes = new Flashes()
  const gravity = new Gravity()
  const motion = new PieceMotion()
  const input = new Input(game)

  let scene: Scene = 'menu'

  const startSolo = (): void => {
    scene = 'play'
    game.start()
    input.attach()
  }

  const openMenu = (): void => {
    scene = 'menu'
    input.detach()
    ui.hideOverlay()
    menu.show()
  }

  const menu = new Menu({ onSolo: startSolo, onQuit: host?.quit })

  wireEvents(game, { fx, ui, flashes, motion, gravity, scores })

  return new P5((p: P5) => {
    p.windowResized = (): void => {
      const size = getWindowSize()
      p.resizeCanvas(size.width, size.height, true)
    }

    p.setup = (): void => {
      const size = getWindowSize()
      p.frameRate(60)
      p.createCanvas(size.width, size.height, p.WEBGL)
      p.setAttributes('antialias', true)
      // The app opens on the menu; the well stays empty (and animating) behind
      // it until "Solo" deals the first piece. Input is only attached in play.
      menu.show()

      // Best score comes from disk; a new record pushed from the main process
      // surfaces as a banner.
      void scores?.get().then((best) => ui.setBest(best))
      scores?.onBeaten((best) => ui.showBanner(`New high score: ${best}`))
    }

    /**
     * In-game keys that aren't rebindable game actions. Returning `false` tells
     * p5 to preventDefault — Tab would otherwise walk the browser's focus ring.
     */
    p.keyPressed = (): boolean | void => {
      if (scene !== 'play') return
      // Tab reveals the controls legend under the well, and hides it again.
      if (p.key === 'Tab') {
        ui.toggleLegend()
        return false
      }
      // Back to the menu from a paused or finished game — the only two moments
      // where dropping the run can't cost the player anything.
      if ((p.key === 'm' || p.key === 'M') && (game.isPaused || game.gameOver)) openMenu()
    }

    p.mouseMoved = (): void => menu.pointer(p.mouseX, p.mouseY)
    p.mousePressed = (): void => menu.click(p.mouseX, p.mouseY)

    p.draw = (): void => {
      const dt = Math.min(p.deltaTime / 1000, 0.05)

      // 1. Input auto-repeat + gravity, both on real-time clocks. Both are
      //    frozen while the menu is up, so the board is a live still life.
      const playing = scene === 'play'
      if (playing) input.update(dt)
      if (playing && !game.isPaused && !game.gameOver) {
        gravity.update(dt, game)
        // Gravity only ever *falls*; the lock clock is what finally commits a
        // grounded piece, and it runs on frames so the grace period is real time.
        game.tick(dt)
      }

      // 2. Advance every animation clock.
      motion.update(dt, game)
      flashes.update(dt)
      fx.update(dt)
      ui.update(dt)
      menu.update(dt)
      bg.setLevel(game.level)
      bg.update(dt)

      // 3. Render.
      const angle = sway(p.frameCount)
      applyProjection(p)
      const clear = bg.clearColor()
      p.background(clear[0], clear[1], clear[2])

      // Evolving backdrop — drawn first, while no lights are active, so its
      // unlit fills render at their literal colours. Shares the camera so it
      // sways with the board, for a touch of parallax.
      inWorld(p, fx, angle, () => bg.draw(p))

      applyLights(p)

      inWorld(p, fx, angle, () => {
        drawWell(p)
        drawLockedField(p, game.field)
        drawGhost(p, game, motion.x)
        drawActive(p, game, motion.x, motion.y, motion.pop)
        flashes.draw(p)

        // Side panels: hold (left) and the next queue (right, top-down).
        const px = (COLS / 2 + 3) * CELL
        const top = -(ROWS / 2 - 2) * CELL
        drawPanel(p, game.holdPiece, -px, top)
        game.nextPieces
          .slice(-3)
          .reverse()
          .forEach((piece, i) => drawPanel(p, piece, px, top + i * CELL * 3.4))

        fx.draw(p)
      })

      // Chrome composited last, over the scene: the HUD only while playing, the
      // menu over everything (it no-ops once its fade-out has finished).
      if (playing) ui.paint(p)
      menu.paint(p)
    }
  }, el)
}

export default render
