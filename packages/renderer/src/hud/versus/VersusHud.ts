import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { UI } from '../../config/themes'
import type { Game } from '@tetris/engine'
import { chromeScale, versusOffsets } from '../../scene/camera'
import type { VersusMatch } from '../../app/versus'
import { composite, ensureBuffer, FG, MONO, panel, panelLabel, RED, setTracking, titlebarClearance } from '../widgets'

/**
 * The Versus-only chrome: a compact "PLAYER"/"BOT" label + score/lines strip
 * above each board, and the win/lose result card. Deliberately separate from
 * `Ui` (solo's HUD) rather than an extension of it — solo's full-screen
 * vignette/legend/single-board overlay stay untouched, and this only ever
 * draws over the two-board Versus layout.
 */

const LABEL_TOP = 40
const STAT_GAP = 16

function chromeTop(): number {
  return titlebarClearance() + LABEL_TOP
}

export class VersusHud {
  private g?: P5.Graphics

  public paint(p: P5, match: VersusMatch): void {
    const w = p.width
    const h = p.height
    const g = (this.g = ensureBuffer(p, this.g, w, h))
    g.clear(0, 0, 0, 0)
    g.textFont(MONO)

    const offsets = versusOffsets(p)
    const scale = chromeScale(p)
    this.drawSide(g, p, offsets.player.x, 'PLAYER', match.player.game, UI.accent, scale)
    this.drawSide(g, p, offsets.bot.x, 'BOT', match.bot.game, FG, scale)

    if (match.isOver) this.drawResult(g, p, match)
    else if (match.isPaused) this.drawPaused(g, p)

    setTracking(g, 0)
    composite(p, g)
  }

  private drawSide(g: P5.Graphics, p: P5, offsetX: number, label: string, game: Game, color: RGB, scale: number): void {
    const cx = p.width / 2 + offsetX
    const y = chromeTop()
    panelLabel(g, label, cx, y, color, 1)

    g.push()
    g.translate(cx, y + 8)
    g.scale(scale)
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 200)
    g.textAlign(g.CENTER, g.TOP)
    g.textSize(13)
    setTracking(g, 0.6)
    g.text(`${game.score}`, 0, 0)
    g.pop()
  }

  private drawResult(g: P5.Graphics, p: P5, match: VersusMatch): void {
    const won = match.winner === 'player'
    this.drawCard(g, p, {
      title: won ? 'YOU WIN' : 'YOU LOSE',
      titleColor: won ? UI.accent : RED,
      sub: `${match.player.game.score} vs ${match.bot.game.score}`,
      hint: 'Enter to replay  ·  M for menu'
    })
  }

  /** Mirrors Solo's pause card ("Esc to resume · Tab controls · M for menu") for the two-board layout. */
  private drawPaused(g: P5.Graphics, p: P5): void {
    this.drawCard(g, p, {
      title: 'PAUSED',
      titleColor: UI.accent,
      hint: 'Esc to resume  ·  M for menu'
    })
  }

  private drawCard(g: P5.Graphics, p: P5, opts: { title: string; titleColor: RGB; sub?: string; hint: string }): void {
    const w = p.width
    const h = p.height
    const scale = chromeScale(p)

    g.push()
    g.noStroke()
    g.fill(4, 6, 12, 0.55 * 255)
    g.rect(0, 0, w, h)
    g.pop()

    const cardW = 380
    const cardH = opts.sub ? 150 : 118

    g.push()
    g.translate(w / 2, h / 2)
    g.scale(scale)

    panel(g, -cardW / 2, -cardH / 2, cardW, cardH, { r: 16, fill: [16, 20, 34], fillA: 0.82 * 255, strokeA: 60 })

    g.noStroke()
    g.fill(opts.titleColor[0], opts.titleColor[1], opts.titleColor[2], 255)
    g.textAlign(g.CENTER, g.CENTER)
    g.textSize(30)
    setTracking(g, 4)
    g.text(opts.title, -2, opts.sub ? -34 : -16)

    if (opts.sub) {
      g.fill(FG[0], FG[1], FG[2], 200)
      g.textAlign(g.CENTER, g.CENTER)
      g.textSize(12)
      setTracking(g, 0.6)
      g.text(opts.sub, -0.5, 4)
    }

    g.fill(FG[0], FG[1], FG[2], 160)
    g.textSize(11)
    setTracking(g, 0.8)
    g.text(opts.hint, -0.5, opts.sub ? STAT_GAP + 24 : STAT_GAP + 14)
    g.pop()
  }
}
