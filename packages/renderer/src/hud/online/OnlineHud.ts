import type P5 from 'p5'
import type { RGB } from '../../core/color'
import { UI } from '../../config/themes'
import type { Game } from '@tetris/engine'
import type { OnlineClientState, RemoteProjection } from '../../app/online'
import { chromeScale, versusOffsets } from '../../scene/camera'
import { composite, ensureBuffer, FG, MONO, panel, panelLabel, RED, setTracking, titlebarClearance } from '../widgets'

/**
 * Online Versus chrome: labels + score/lines above each board, connection
 * status, and terminal (game-over / disconnect) cards. Remote side is a
 * display-only {@link RemoteProjection} — not a `Game`.
 */

const LABEL_TOP = 40
const STAT_GAP = 16

function chromeTop(): number {
  return titlebarClearance() + LABEL_TOP
}

export interface OnlineHudPaintInput {
  state: OnlineClientState
  localGame: Game | null
  remote: RemoteProjection | null
  localLabel?: string
  remoteLabel?: string
}

export class OnlineHud {
  private g?: P5.Graphics

  public paint(p: P5, input: OnlineHudPaintInput): void {
    const w = p.width
    const h = p.height
    const g = (this.g = ensureBuffer(p, this.g, w, h))
    g.clear(0, 0, 0, 0)
    g.textFont(MONO)

    const offsets = versusOffsets(p)
    const scale = chromeScale(p)
    const localName = input.localLabel ?? 'YOU'
    const remoteName = input.remoteLabel ?? 'OPPONENT'

    if (input.localGame) {
      this.drawSide(g, p, offsets.player.x, localName, input.localGame.score, input.localGame.lines, UI.accent, scale)
    }
    if (input.remote) {
      this.drawSide(g, p, offsets.bot.x, remoteName, input.remote.score, input.remote.lines, FG, scale)
    } else {
      this.drawWaiting(g, p, offsets.bot.x, remoteName, scale)
    }

    this.drawConnection(g, p, input.state)

    const match = input.state.match
    if (match?.gameOver) {
      const selfId = input.state.user?.id
      const self = match.gameOver.standings.find((s) => s.userId === selfId)
      const won = self?.place === 1
      this.drawCard(g, p, {
        title: won ? 'YOU WIN' : 'YOU LOSE',
        titleColor: won ? UI.accent : RED,
        sub: match.gameOver.standings.map((s) => `${s.score}`).join(' vs '),
        hint: 'M for menu'
      })
    } else if (input.state.connection === 'disconnected' || input.state.connection === 'error') {
      this.drawCard(g, p, {
        title: 'DISCONNECTED',
        titleColor: RED,
        sub: input.state.lastError?.message ?? 'Connection closed',
        hint: 'M for menu'
      })
    } else if (match?.elimination && match.elimination.userId === input.state.user?.id && !match.gameOver) {
      this.drawCard(g, p, {
        title: 'ELIMINATED',
        titleColor: RED,
        sub: 'Waiting for match to end…',
        hint: 'M for menu'
      })
    }

    setTracking(g, 0)
    composite(p, g)
  }

  private drawSide(
    g: P5.Graphics,
    p: P5,
    offsetX: number,
    label: string,
    score: number,
    lines: number,
    color: RGB,
    scale: number
  ): void {
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
    g.text(`${score}  ·  ${lines}L`, 0, 0)
    g.pop()
  }

  private drawWaiting(g: P5.Graphics, p: P5, offsetX: number, label: string, scale: number): void {
    const cx = p.width / 2 + offsetX
    const y = chromeTop()
    panelLabel(g, label, cx, y, FG, 0.55)
    g.push()
    g.translate(cx, y + 8)
    g.scale(scale)
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 120)
    g.textAlign(g.CENTER, g.TOP)
    g.textSize(12)
    setTracking(g, 0.6)
    g.text('Waiting…', 0, 0)
    g.pop()
  }

  private drawConnection(g: P5.Graphics, p: P5, state: OnlineClientState): void {
    const label =
      state.connection === 'ready'
        ? state.lobby === 'in-match'
          ? 'ONLINE'
          : state.lobby.toUpperCase()
        : state.connection.toUpperCase()
    g.push()
    g.noStroke()
    g.fill(FG[0], FG[1], FG[2], 140)
    g.textAlign(g.CENTER, g.TOP)
    g.textSize(11)
    setTracking(g, 1.2)
    g.text(label, p.width / 2, titlebarClearance() + 12)
    g.pop()
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
