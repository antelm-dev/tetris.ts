import P5 from 'p5'
import { getWindowSize } from '../core/dom'
import { CELL, COLS, ROWS, sidePanelTop, sidePanelX } from '../core/geometry'
import { Game } from '../engine'
import { MODES } from '../engine/modes'
import type { ModeId } from '../engine/modes'
import { Input } from '../input/Input'
import { Menu } from '../hud/Menu'
import { Ui } from '../hud/Ui'
import { VersusHud } from '../hud/VersusHud'
import { Background } from '../scene/background'
import { Effects } from '../scene/effects'
import { Flashes } from '../scene/flashes'
import { applyLights, applyProjection, fitScale, inWorld, sway, versusOffsets, withBoard } from '../scene/camera'
import { drawActive, drawGhost, drawLockedField, drawPanel, drawWell } from '../scene/blocks'
import { wireEvents } from './events'
import { Gravity, PieceMotion } from './loop'
import type { HighScores, Host } from './host'
import { bestScoreOf, beatenBannerText, EMPTY_RECORDS, type RecordsState } from './records'
import { VersusMatch, type VersusSide } from './versus'
import type { BotDifficulty } from '../bot/types'

/**
 * The composition root: owns the engine and every presentation object, wires
 * them together, and drives the p5 lifecycle. It decides *when* things happen —
 * the drawing itself lives in `scene/`, the chrome in `hud/`, and the mapping
 * from engine events to visuals in `events.ts`.
 */

/**
 * What the sketch is currently showing. In `menu` the board is still drawn and
 * animating — it just doesn't tick — so the menu sits over a living scene and
 * a theme change previews itself on the well behind the card. `versus` swaps
 * the single Solo `Game` for a whole `VersusMatch` (two independent games).
 */
type Scene = 'menu' | 'play' | 'versus'

/** Draw one Versus board's well/field/piece/panels — the same board-drawing functions Solo uses. */
function drawVersusBoard(p: P5, side: VersusSide): void {
  drawWell(p)
  drawLockedField(p, side.game.field)
  drawGhost(p, side.game, side.motion.x)
  drawActive(p, side.game, side.motion.x, side.motion.y, side.motion.pop)
  side.flashes.draw(p)

  const px = sidePanelX()
  const top = sidePanelTop()
  drawPanel(p, side.game.holdPiece, -px, top)
  side.game.nextPieces
    .slice(-3)
    .reverse()
    .forEach((piece, i) => drawPanel(p, piece, px, top + i * CELL * 3.4))

  side.fx.draw(p)
}

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
  const versusHud = new VersusHud()

  let scene: Scene = 'menu'
  // Cached from the last fetch/push so a mode switch can seed its Best/Time
  // stat before the run's first frame, without an extra round trip.
  let records: RecordsState = EMPTY_RECORDS
  let currentModeId: ModeId = 'endless'

  // The live match and the Input wired to *its* human game — both rebuilt
  // fresh on every Versus start/replay, and torn down on return to the menu.
  let match: VersusMatch | undefined
  let versusInput: Input | undefined

  const startSolo = (modeId: ModeId): void => {
    scene = 'play'
    currentModeId = modeId
    const mode = MODES[modeId]
    game.mode = mode
    ui.setMode(mode)
    ui.setBest(bestScoreOf(records, modeId))
    game.start()
    input.attach()
  }

  const teardownVersus = (): void => {
    versusInput?.dispose()
    versusInput = undefined
    match = undefined
  }

  const startVersus = (difficulty: BotDifficulty): void => {
    teardownVersus()
    scene = 'versus'
    match = new VersusMatch(difficulty)
    versusInput = new Input(match.player.game)
    versusInput.attach()
  }

  const openMenu = (): void => {
    scene = 'menu'
    input.detach()
    teardownVersus()
    ui.hideOverlay()
    menu.show()
  }

  const menu = new Menu({
    onSelectMode: startSolo,
    onVersus: startVersus,
    onQuit: host?.quit
  })

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

      // Records come from disk; a new one pushed from the main process (while
      // this is the mode currently being played) surfaces as a banner.
      void scores
        ?.get()
        .then((r) => (records = r))
        .catch(() => {
          // Records load is best-effort; the game stays playable without it.
        })
      scores?.onBeaten((modeId, r) => {
        records = r
        if (modeId === currentModeId) ui.showBanner(beatenBannerText(modeId, r))
      })
    }

    /**
     * In-game keys that aren't rebindable game actions. Returning `false` tells
     * p5 to preventDefault — Tab would otherwise walk the browser's focus ring.
     */
    p.keyPressed = (): boolean | void => {
      if (scene === 'play') {
        // Tab reveals the controls legend under the well, and hides it again;
        // it also dismisses the one-shot start-of-run hint early.
        if (p.key === 'Tab') {
          ui.toggleLegend()
          ui.dismissStartHint()
          return false
        }
        // Back to the menu from a paused, finished or completed game — the only
        // moments where dropping the run can't cost the player anything.
        if ((p.key === 'm' || p.key === 'M') && (game.isPaused || game.gameOver || game.completed)) openMenu()
        return
      }

      if (scene === 'versus' && match?.isOver) {
        // Only once the match has actually ended — dropping a live match this
        // way would cost the player their run, unlike Solo's pause/over gate.
        if (p.key === 'Enter' || p.key === ' ') {
          startVersus(match.difficulty)
          return false
        }
        if (p.key === 'Escape' || p.key === 'm' || p.key === 'M') openMenu()
      }
    }

    // Only ever reaches the menu — gameplay has no mouse input, so there's
    // nothing for these to leak into while `scene !== 'menu'`.
    let lastCursor: 'pointer' | 'default' = 'default'
    const syncCursor = (): void => {
      const next = scene === 'menu' ? menu.cursorStyle(p.mouseX, p.mouseY) : 'default'
      if (next === lastCursor) return
      lastCursor = next
      p.cursor(next === 'pointer' ? p.HAND : p.ARROW)
    }

    p.mouseMoved = (): void => {
      menu.pointer(p.mouseX, p.mouseY)
      syncCursor()
    }
    p.mousePressed = (): void => {
      menu.click(p.mouseX, p.mouseY)
      syncCursor()
    }
    p.mouseWheel = (event?: object): boolean | void => {
      if (!menu.isOpen) return
      const delta = (event as { delta?: number } | undefined)?.delta ?? 0
      menu.wheel(delta)
      return false
    }

    p.draw = (): void => {
      const dt = Math.min(p.deltaTime / 1000, 0.05)

      const playing = scene === 'play'
      const inVersus = scene === 'versus' && !!match

      // 1. Input auto-repeat + gravity, both on real-time clocks. Both are
      //    frozen while the menu is up, so the board is a live still life.
      if (playing) input.update(dt)
      if (playing && !game.isPaused && !game.gameOver && !game.completed) {
        gravity.update(dt, game)
        // Gravity only ever *falls*; the lock clock is what finally commits a
        // grounded piece, and it runs on frames so the grace period is real time.
        game.tick(dt)
      }
      // The mode's live clock (Sprint's elapsed count-up, Ultra's countdown) —
      // a no-op for a mode with none. Kept in sync every frame, including
      // while paused/over/completed, so it reads correctly the instant a
      // fresh run zeroes `elapsedMs` back out.
      if (playing) ui.setElapsedMs(game.elapsedMs)

      if (inVersus) {
        versusInput?.update(dt)
        match?.update(dt)
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
      // The backdrop is a fixed, oversized decoration (see `Background.draw`),
      // not tied to the board's footprint — the same fit-scale reads fine
      // whether one board or two are on screen.
      const scale = fitScale(p)
      applyProjection(p)
      const clear = bg.clearColor()
      p.background(clear[0], clear[1], clear[2])

      // Evolving backdrop — drawn first, while no lights are active, so its
      // unlit fills render at their literal colours. Shares the camera so it
      // sways with the board, for a touch of parallax.
      inWorld(p, fx, angle, scale, () => bg.draw(p))

      applyLights(p)

      if (inVersus && match) {
        const activeMatch = match
        const offsets = versusOffsets(p)
        // Camera shake follows the human board — the primary visual focus —
        // even though both boards share the one camera transform. Scale is 1
        // here: `versusOffsets` already returns each board's *final*
        // position/scale, so a second multiplier here would compound with it.
        inWorld(p, activeMatch.player.fx, angle, 1, () => {
          withBoard(p, offsets.player.x, offsets.player.scale, () => drawVersusBoard(p, activeMatch.player))
          withBoard(p, offsets.bot.x, offsets.bot.scale, () => drawVersusBoard(p, activeMatch.bot))
        })
      } else {
        inWorld(p, fx, angle, scale, () => {
          drawWell(p)
          drawLockedField(p, game.field)
          drawGhost(p, game, motion.x)
          drawActive(p, game, motion.x, motion.y, motion.pop)
          flashes.draw(p)

          // Side panels: hold (left) and the next queue (right, top-down).
          const px = sidePanelX()
          const top = sidePanelTop()
          drawPanel(p, game.holdPiece, -px, top)
          game.nextPieces
            .slice(-3)
            .reverse()
            .forEach((piece, i) => drawPanel(p, piece, px, top + i * CELL * 3.4))

          fx.draw(p)
        })
      }

      // Chrome composited last, over the scene: the HUD only while playing, the
      // menu over everything (it no-ops once its fade-out has finished).
      if (playing) ui.paint(p)
      if (inVersus && match) versusHud.paint(p, match)
      menu.paint(p)
    }
  }, el)
}

export default render
