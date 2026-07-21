import type { RGB } from '../core/color'
import { cellToWorld, CELL, COLS } from '../core/geometry'
import { formatClock } from '../core/time'
import { settings } from '../config/settings'
import { PALETTE } from '../config/themes'
import type { Game } from '../engine'
import type { Effects } from '../scene/effects'
import type { Flashes } from '../scene/flashes'
import { centroid, pieceCells } from '../scene/cells'
import type { Ui } from '../hud/ui'
import type { Gravity, PieceMotion } from './loop'
import type { HighScores } from './host'
import { bestScoreOf, completionSubmission, gameOverSubmission, type SubmitPayload } from './records'
import type { StatisticsStore } from './statistics'
import type { AudioManager, Side } from '../audio/AudioManager'

/**
 * The translation layer between the engine and the presentation: every hook the
 * `Game` fires is turned into particles, screen-shake, flashes, HUD updates and
 * (via `audio`) sound here, and nowhere else. The engine knows none of these exist.
 */
export interface Presentation {
  fx: Effects
  ui: Ui
  flashes: Flashes
  motion: PieceMotion
  gravity: Gravity
  scores?: HighScores
  statistics?: StatisticsStore
  audio?: AudioManager
  /** Which Versus board this is — omitted (or `'player'`) for Solo. See `AudioManager`'s per-side mixing. */
  side?: Side
}

export function wireEvents(game: Game, view: Presentation): void {
  const { fx, ui, flashes, motion, gravity, scores, statistics, audio, side } = view

  // Comfort-setting multipliers live at this seam rather than inside `Effects`
  // itself, so its API stays untouched: reduced motion zeroes shake entirely
  // (not just dampens it), and the effects-intensity slider scales particle
  // counts rather than each burst's own tuning.
  const shake = (amount: number): void => fx.shake(amount * settings.shakeMultiplier)
  const burst = (x: number, y: number, count: number, color: RGB, spread?: number): void =>
    fx.burst(x, y, Math.round(count * settings.effectsIntensity), color, spread)
  const line = (y: number, halfWidth: number, color: RGB, count?: number): void =>
    fx.line(y, halfWidth, color, count === undefined ? undefined : Math.round(count * settings.effectsIntensity))

  game.events = {
    onSpawn: () => motion.onSpawn(),

    onMove: () => audio?.move(side),

    onRotate: (kicked) => {
      motion.onRotate()
      audio?.rotate(kicked, side)
    },

    onHold: () => audio?.hold(side),

    onSpin: (name, lines) => {
      if (name === 'T') statistics?.recordTSpin()
      // Extra flourish for a spin: a bright pop plus a spark burst centered
      // on the piece, so a tucked T-spin / L-spin reads as a special move.
      const ap = game.activePiece
      motion.onRotate(1.4)
      if (ap) {
        const c = centroid(pieceCells(ap))
        const { x, y } = cellToWorld(c.col, c.row)
        burst(x, y, 18, PALETTE[name].glow, 300)
      }
      shake(0.4)
      ui.setScore(game.score) // a spin scores even with no line clear
      ui.announceSpin(name, lines)
      audio?.spin(name, lines, side)
    },

    onLock: (hard) => {
      const ap = game.activePiece
      if (ap) statistics?.recordPiece(ap.name)
      if (ap) {
        const cells = pieceCells(ap)
        flashes.lock(cells)
        const bottom = cells.reduce((m, c) => Math.max(m, c.row), 0)
        const { x, y } = cellToWorld(centroid(cells).col, bottom)
        burst(x, y, hard ? 22 : 10, PALETTE[ap.name].glow, hard ? 260 : 150)
      }
      shake(hard ? 0.5 : 0.22)
      ui.setScore(game.score)
      audio?.lock(hard, side)
    },

    onClear: (rows, count, level) => {
      if (count === 4) statistics?.recordTetris()
      for (const r of rows) {
        flashes.clear(r)
        const { y } = cellToWorld(0, r)
        const tint: RGB = count >= 4 ? [255, 230, 120] : [180, 240, 255]
        line(y, (COLS * CELL) / 2, tint, 40 + count * 8)
      }
      // Trauma scales with the row count, so a Tetris hits four times as hard
      // as a single instead of the near-flat curve a large base term gives.
      shake(count * 0.22)
      ui.setScore(game.score)
      ui.setLines(game.lines)
      ui.setLevel(level)
      ui.announceClear(count)
      audio?.clear(rows, count, level, side)
    },

    onPerfectClear: (lines, level) => {
      statistics?.recordPerfectClear()
      const gold: RGB = [255, 224, 130]
      burst(0, 0, 48, gold, 420)
      shake(0.75)
      ui.setScore(game.score)
      ui.announcePerfectClear(lines)
      audio?.perfectClear(lines, level, side)
    },

    onB2B: (chain, name, lines) => {
      // Reward an unbroken chain with a bright golden burst across the well,
      // scaled up slightly as the chain grows.
      const gold: RGB = [255, 224, 130]
      const mag = Math.min(1.5, 0.6 + chain * 0.12)
      burst(0, 0, 24, gold, 340 * mag)
      shake(0.4 + Math.min(0.4, chain * 0.06))
      ui.setScore(game.score)
      ui.announceB2B(chain)
      audio?.b2b(chain, name, lines, side)
    },

    onCombo: (combo, level) => {
      statistics?.recordCombo(combo + 1)
      // A quick cyan spark burst that grows with the combo, plus a nudge.
      const cyan: RGB = [140, 235, 255]
      burst(0, 0, 8 + combo * 2, cyan, 180 + combo * 30)
      shake(0.15 + Math.min(0.35, combo * 0.05))
      ui.setScore(game.score)
      ui.announceCombo(combo + 1)
      audio?.combo(combo, level, side)
    },

    onLevelUp: (level) => {
      ui.setLevel(level)
      audio?.levelUp(level, side)
    },

    onGameOver: (score) => {
      statistics?.finishRun({
        mode: game.mode.id,
        score,
        lines: game.lines,
        elapsedMs: game.elapsedMs,
        completed: false
      })
      shake(0.8)
      ui.showOverlay('Game Over', `Score ${score} · Space to replay · M for menu`, 'over')
      audio?.gameOver(side)
      // A game over only counts toward a mode's record when that mode ranks
      // by score regardless of whether the run was completed (Sprint's time
      // is meaningless without a successful clear — see `gameOverSubmission`).
      const payload = gameOverSubmission(game.mode.id, score, game.elapsedMs)
      if (payload) submitRecord(payload)
    },

    onComplete: (score, elapsedMs) => {
      statistics?.finishRun({ mode: game.mode.id, score, lines: game.lines, elapsedMs, completed: true })
      shake(0.5)
      const sub =
        game.mode.emphasis === 'time'
          ? `Time ${formatClock(elapsedMs, true)} · Space to replay · M for menu`
          : `Score ${score} · Space to replay · M for menu`
      ui.showOverlay(`${game.mode.name} Complete`, sub, 'complete')
      audio?.complete()
      const payload = completionSubmission(game.mode.id, score, elapsedMs)
      if (payload) submitRecord(payload)
    },

    onPause: (paused) => {
      if (paused) ui.showOverlay('Paused', 'Esc to resume · Tab controls · M for menu', 'pause')
      else ui.hideOverlay()
      audio?.setPaused(paused)
    },

    onStart: () => {
      statistics?.startRun()
      gravity.reset()
      flashes.reset()
      ui.setScore(0)
      ui.setLines(0)
      ui.setLevel(1)
      ui.clearMove()
      ui.hideOverlay()
      ui.showStartHint()
      audio?.start(side)
    },

    onGarbageReceived: (count) => audio?.garbageReceived(count, side)
  }

  /**
   * Persist a run's record. `submit` reports whether it beat the stored one,
   * in which case the Best stat updates immediately; the celebratory banner
   * is a separate concern, driven by the `onBeaten` push event (see `sketch.ts`).
   */
  function submitRecord(payload: SubmitPayload): void {
    void scores
      ?.submit(payload)
      .then((result) => {
        if (result.beaten) ui.setBest(bestScoreOf(result.records, game.mode.id))
      })
      .catch(() => {
        // Persistence is optional — a bridge/fs failure must not reject unhandled.
      })
  }
}
