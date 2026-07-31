import P5 from 'p5'
import { getWindowSize } from '../core/dom'
import { CELL, COLS, ROWS, sidePanelTop, sidePanelX, cellToWorld } from '../core/geometry'
import { Game, type Action } from '@tetris/engine'
import { MODES } from '@tetris/engine/modes'
import type { ModeId } from '@tetris/engine/modes'
import type { GameAction } from '@tetris/protocol'
import { Input } from '../input/Input'
import { Menu } from '../hud/menu'
import { Ui } from '../hud/ui'
import { VersusHud } from '../hud/versus'
import { OnlineHud, OnlineLobby, nextOnlineSceneAction } from '../hud/online'
import { Background } from '../scene/background'
import { Effects } from '../scene/effects'
import { Flashes } from '../scene/flashes'
import { applyLights, applyProjection, fitScale, inWorld, sway, versusOffsets, withBoard } from '../scene/camera'
import { drawActive, drawGhost, drawLockedField, drawPanel, drawWell } from '../scene/blocks'
import { drawRemoteProjection } from '../scene/remote'
import { wireEvents } from './events'
import { Gravity, PieceMotion } from './loop'
import type { HighScores, Host } from './host'
import { bestScoreOf, beatenBannerText, EMPTY_RECORDS, type RecordsState } from './records'
import { VersusMatch, type VersusSide } from './versus'
import type { BotDifficulty } from '@tetris/bot/types'
import { browserStatistics } from './statistics'
import { settings } from '../config/settings'
import { TouchControls } from '../input/TouchControls'
import { AudioManager } from '../audio/AudioManager'
import { createOnlineClient, type OnlineClient } from './online'
import { isOnlineMultiplayerUiEnabled } from './onlineFlag'
import { centroid, pieceCells } from '../scene/cells'
import { PALETTE } from '../config/themes'
import type { RGB } from '../core/color'

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
 * `online` is a networked two-board layout driven by {@link OnlineClient}.
 */
type Scene = 'menu' | 'play' | 'versus' | 'online'

/** Draw one Versus board's well/field/piece/panels — the same board-drawing functions Solo uses. */
function drawVersusBoard(p: P5, side: VersusSide): void {
  drawWell(p)
  drawLockedField(p, side.game.field)
  if (settings.ghost) drawGhost(p, side.game, side.motion.x)
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

const render = (el: HTMLElement, scores?: HighScores, host?: Host, web = false): P5 => {
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
  const onlineHud = new OnlineHud()
  const statistics = browserStatistics()
  const touch = web ? new TouchControls(el) : undefined

  // One `AudioManager` for the whole sketch — shared by Solo and both sides of
  // a Versus match (see `app/versus.ts`) rather than one per `Game`. Web Audio
  // requires a user gesture before it can start; `unlock()` is deferred to the
  // very first pointer/key interaction anywhere, not tied to a specific
  // control, since the menu itself is the first thing on screen.
  const audio = new AudioManager()
  const unlockAudio = (): void => void audio.unlock()
  window.addEventListener('pointerdown', unlockAudio, { once: true })
  window.addEventListener('keydown', unlockAudio, { once: true })
  audio.setMusicVolume(settings.musicVolume)
  audio.setEffectsVolume(settings.effectsVolume)
  audio.setMuted(settings.muted)
  settings.subscribe((s) => {
    audio.setMusicVolume(s.musicVolume)
    audio.setEffectsVolume(s.effectsVolume)
    audio.setMuted(s.muted)
  })

  let scene: Scene = 'menu'
  // Cached from the last fetch/push so a mode switch can seed its Best/Time
  // stat before the run's first frame, without an extra round trip.
  let records: RecordsState = EMPTY_RECORDS
  let currentModeId: ModeId = 'endless'

  // The live match and the Input wired to *its* human game — both rebuilt
  // fresh on every Versus start/replay, and torn down on return to the menu.
  let match: VersusMatch | undefined
  let versusInput: Input | undefined

  // Online Versus: client + lobby overlay + local presentation only.
  let onlineClient: OnlineClient | undefined
  let onlineLobby: OnlineLobby | undefined
  let onlineInput: Input | undefined
  let onlineMotion: PieceMotion | undefined
  let onlineFx: Effects | undefined
  let onlineFlashes: Flashes | undefined
  let onlineUnsub: (() => void) | undefined

  const startSolo = (modeId: ModeId): void => {
    scene = 'play'
    currentModeId = modeId
    const mode = MODES[modeId]
    game.mode = mode
    ui.setMode(mode)
    ui.setBest(bestScoreOf(records, modeId))
    game.start()
    input.attach()
    touch?.show(input)
  }

  const teardownVersus = (): void => {
    versusInput?.dispose()
    versusInput = undefined
    match = undefined
  }

  const teardownOnline = (): void => {
    onlineUnsub?.()
    onlineUnsub = undefined
    onlineInput?.dispose()
    onlineInput = undefined
    onlineMotion = undefined
    onlineFx = undefined
    onlineFlashes = undefined
    onlineLobby?.dispose()
    onlineLobby = undefined
    onlineClient?.dispose()
    onlineClient = undefined
  }

  const startVersus = (difficulty: BotDifficulty): void => {
    teardownVersus()
    scene = 'versus'
    match = new VersusMatch(difficulty, { audio })
    versusInput = new Input(match.player.game)
    versusInput.attach()
    touch?.show(versusInput)
  }

  const wireOnlinePresentation = (local: Game): void => {
    onlineMotion = new PieceMotion()
    onlineFx = new Effects()
    onlineFlashes = new Flashes()
    const motionRef = onlineMotion
    const fxRef = onlineFx
    const flashesRef = onlineFlashes
    const shake = (amount: number): void => fxRef.shake(amount * settings.shakeMultiplier)
    const burst = (x: number, y: number, count: number, color: RGB, spread?: number): void =>
      fxRef.burst(x, y, Math.round(count * settings.effectsIntensity), color, spread)

    onlineClient?.wireLocalEvents({
      onSpawn: () => motionRef.onSpawn(),
      onMove: () => audio.move('player'),
      onRotate: (kicked) => {
        motionRef.onRotate()
        audio.rotate(kicked, 'player')
      },
      onHold: () => audio.hold('player'),
      onLock: (hard) => {
        const ap = local.activePiece
        if (ap) {
          const cells = pieceCells(ap)
          flashesRef.lock(cells)
          const bottom = cells.reduce((m, c) => Math.max(m, c.row), 0)
          const { x, y } = cellToWorld(centroid(cells).col, bottom)
          burst(x, y, hard ? 22 : 10, PALETTE[ap.name].glow, hard ? 260 : 150)
        }
        shake(hard ? 0.5 : 0.22)
        audio.lock(hard, 'player')
      },
      onClear: (rows, count, level) => {
        for (const r of rows) {
          flashesRef.clear(r)
        }
        shake(count * 0.22)
        audio.clear(rows, count, level, 'player')
      },
      onGarbageReceived: (count) => {
        shake(0.3 + count * 0.05)
        audio.garbageReceived(count, 'player')
      },
      onGameOver: () => audio.gameOver('player')
    })
  }

  const enterOnlineMatch = (): void => {
    const local = onlineClient?.localGame
    if (!local || !onlineClient) return
    scene = 'online'
    onlineLobby?.setMatchSceneActive(true)
    onlineLobby?.hide()
    wireOnlinePresentation(local)
    onlineInput?.dispose()
    onlineInput = new Input({
      action: (a: Action) => onlineClient!.sendAction(a as GameAction)
    })
    onlineInput.attach()
    // Online deliberately skips web touch controls (Phase 2 non-goal).
    touch?.hide()
  }

  const openOnline = (): void => {
    teardownVersus()
    teardownOnline()
    scene = 'menu'
    menu.hide()
    onlineClient = createOnlineClient(host?.apiOrigin)
    onlineLobby = new OnlineLobby(onlineClient, {
      onExit: () => openMenu()
    })
    onlineLobby.show()
    onlineUnsub = onlineClient.subscribe((state) => {
      const action = nextOnlineSceneAction({ sceneIsOnline: scene === 'online', lobby: state.lobby }, state)
      if (action === 'enter-match') enterOnlineMatch()
      else if (action === 'leave-to-menu' && scene === 'online') openMenu()
    })
  }

  const openMenu = (): void => {
    scene = 'menu'
    input.detach()
    touch?.hide()
    teardownVersus()
    teardownOnline()
    ui.hideOverlay()
    menu.show()
  }

  // Declared after the open* helpers so their closures capture this binding; assigned
  // immediately below before any user interaction can invoke those helpers.
  let menu: Menu
  menu = new Menu({
    onSelectMode: startSolo,
    onVersus: startVersus,
    onOnlineVersus: isOnlineMultiplayerUiEnabled() ? openOnline : undefined,
    getVersion: host?.getVersion,
    onCheckForUpdates: host?.checkForUpdates,
    onOpenChangelog: host?.openChangelog,
    getStatistics: () => statistics.snapshot(),
    onQuit: host?.quit
  })

  wireEvents(game, { fx, ui, flashes, motion, gravity, scores, statistics, audio })

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
        .then((r) => {
          records = r
          statistics.mergeRecords(r)
        })
        .catch(() => {
          // Records load is best-effort; the game stays playable without it.
        })
      scores?.onBeaten((modeId, r) => {
        records = r
        statistics.mergeRecords(r)
        if (modeId === currentModeId) ui.showBanner(beatenBannerText(modeId, r))
      })
    }

    /**
     * In-game keys that aren't rebindable game actions. Returning `false` tells
     * p5 to preventDefault — Tab would otherwise walk the browser's focus ring.
     */
    p.keyPressed = (): boolean | void => {
      if (onlineLobby?.isOpen) return

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

      if (scene === 'versus' && match) {
        // Replay only once the match has actually ended — dropping a live
        // match this way would cost the player their run.
        if (match.isOver && (p.key === 'Enter' || p.key === ' ')) {
          startVersus(match.difficulty)
          return false
        }
        // Same gate as Solo's: menu-return only from a paused or finished
        // match. Escape itself is the player's ordinary pause bind (handled
        // by `versusInput`, which now freezes the whole match — see
        // `VersusMatch`'s `onPause` wiring) rather than something this
        // handler intercepts directly.
        if ((p.key === 'm' || p.key === 'M') && (match.isOver || match.isPaused)) openMenu()
      }

      if (scene === 'online' && onlineClient) {
        const state = onlineClient.getState()
        const terminal =
          !!state.match?.gameOver ||
          state.connection === 'disconnected' ||
          state.connection === 'error' ||
          (!!state.match?.elimination && state.match.elimination.userId === state.user?.id)
        if ((p.key === 'm' || p.key === 'M') && terminal) openMenu()
      }
    }

    // Only ever reaches the menu — gameplay has no mouse input, so there's
    // nothing for these to leak into while `scene !== 'menu'`.
    let lastCursor: 'pointer' | 'default' = 'default'
    const syncCursor = (): void => {
      const next = onlineLobby?.isOpen
        ? onlineLobby.cursorStyle(p.mouseX, p.mouseY)
        : scene === 'menu'
          ? menu.cursorStyle(p.mouseX, p.mouseY)
          : 'default'
      if (next === lastCursor) return
      lastCursor = next
      p.cursor(next === 'pointer' ? p.HAND : p.ARROW)
    }

    p.mouseMoved = (): void => {
      if (onlineLobby?.isOpen) onlineLobby.pointer(p.mouseX, p.mouseY)
      else menu.pointer(p.mouseX, p.mouseY)
      syncCursor()
    }
    p.mousePressed = (): void => {
      if (onlineLobby?.isOpen) onlineLobby.click(p.mouseX, p.mouseY)
      else menu.click(p.mouseX, p.mouseY)
      syncCursor()
    }
    p.mouseWheel = (event?: object): boolean | void => {
      const delta = (event as { delta?: number } | undefined)?.delta ?? 0
      if (onlineLobby?.isOpen) {
        onlineLobby.wheel(delta)
        return false
      }
      if (!menu.isOpen) return
      menu.wheel(delta)
      return false
    }

    p.draw = (): void => {
      const dt = Math.min(p.deltaTime / 1000, 0.05)

      const playing = scene === 'play'
      const inVersus = scene === 'versus' && !!match
      const inOnline = scene === 'online' && !!onlineClient

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

      const onlineState = inOnline && onlineClient ? onlineClient.getState() : undefined

      if (inOnline && onlineClient && onlineState) {
        onlineInput?.update(dt)
        const local = onlineClient.localGame
        if (local && onlineState.lobby === 'in-match' && !onlineState.match?.gameOver) {
          onlineClient.advance(dt * 1000)
        }
        if (local && onlineMotion) onlineMotion.update(dt, local)
        onlineFlashes?.update(dt)
        onlineFx?.update(dt)
      }

      // 2. Advance every animation clock.
      motion.update(dt, game)
      flashes.update(dt)
      fx.update(dt)
      ui.update(dt)
      menu.update(dt)
      onlineLobby?.update(dt)
      bg.setLevel(inOnline ? (onlineClient?.localGame?.level ?? game.level) : game.level)
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
      inWorld(p, inOnline && onlineFx ? onlineFx : fx, angle, scale, () => bg.draw(p))

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
      } else if (inOnline && onlineClient) {
        const local = onlineClient.localGame
        const remote = onlineClient.remoteProjection
        const offsets = versusOffsets(p)
        const shakeFx = onlineFx ?? fx
        inWorld(p, shakeFx, angle, 1, () => {
          withBoard(p, offsets.player.x, offsets.player.scale, () => {
            drawWell(p)
            if (local) {
              drawLockedField(p, local.field)
              if (settings.ghost && onlineMotion) drawGhost(p, local, onlineMotion.x)
              if (onlineMotion) drawActive(p, local, onlineMotion.x, onlineMotion.y, onlineMotion.pop)
              onlineFlashes?.draw(p)
              const px = sidePanelX()
              const top = sidePanelTop()
              drawPanel(p, local.holdPiece, -px, top)
              local.nextPieces
                .slice(-3)
                .reverse()
                .forEach((piece, i) => drawPanel(p, piece, px, top + i * CELL * 3.4))
              onlineFx?.draw(p)
            }
          })
          withBoard(p, offsets.bot.x, offsets.bot.scale, () => {
            drawWell(p)
            if (remote) drawRemoteProjection(p, remote.board, remote.activePiece)
          })
        })
      } else {
        inWorld(p, fx, angle, scale, () => {
          drawWell(p)
          drawLockedField(p, game.field)
          if (settings.ghost) drawGhost(p, game, motion.x)
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
      if (inOnline && onlineClient && onlineState) {
        onlineHud.paint(p, {
          state: onlineState,
          localGame: onlineClient.localGame,
          remote: onlineClient.remoteProjection
        })
      }
      if (!onlineLobby?.isOpen) menu.paint(p)
      onlineLobby?.paint(p)
    }
  }, el)
}

export default render
