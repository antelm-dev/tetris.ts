import type P5 from 'p5'
import { mix, type RGB } from '../core/color'
import { CELL, COLS, ROWS } from '../core/geometry'

/**
 * One "mood" the backdrop can be in — distinct from the piece themes the player
 * picks (see `config/themes.ts`); these follow the level, not the settings.
 * Everything stays deliberately dark and low-saturation so the playfield keeps
 * its contrast — the accents only ever surface through faint, additive nebula
 * orbs, never the flat gradient.
 */
interface Mood {
  name: string
  top: RGB
  bottom: RGB
  accentA: RGB
  accentB: RGB
}

/**
 * Level moods, walked in order and then cycled. Consecutive entries lean on
 * clearly different hue families (indigo → teal → violet → ember → …) so a
 * level-up reads as a real shift of scenery, not just a brightness tweak.
 */
const MOODS: readonly Mood[] = [
  { name: 'midnight', top: [10, 12, 30], bottom: [4, 5, 12], accentA: [46, 82, 190], accentB: [96, 44, 168] },
  { name: 'abyss', top: [6, 20, 28], bottom: [3, 8, 13], accentA: [26, 140, 150], accentB: [30, 86, 170] },
  { name: 'violet', top: [20, 11, 32], bottom: [7, 4, 15], accentA: [138, 58, 196], accentB: [70, 58, 200] },
  { name: 'ember', top: [28, 13, 17], bottom: [11, 5, 8], accentA: [204, 78, 66], accentB: [168, 52, 104] },
  { name: 'amber', top: [26, 18, 9], bottom: [10, 7, 4], accentA: [206, 138, 48], accentB: [172, 90, 44] },
  { name: 'emerald', top: [8, 24, 17], bottom: [3, 10, 8], accentA: [44, 168, 104], accentB: [30, 122, 138] },
  { name: 'rose', top: [26, 11, 24], bottom: [10, 4, 11], accentA: [206, 66, 132], accentB: [130, 54, 178] },
  { name: 'aurora', top: [10, 20, 32], bottom: [4, 8, 14], accentA: [56, 156, 168], accentB: [92, 100, 200] }
]

interface Orb {
  bx: number
  by: number
  radius: number
  phase: number
  speed: number
  driftX: number
  driftY: number
  bias: number // which accent this orb leans toward (0 = A, 1 = B)
}

/** Copy a mood so the interpolated "current" state can be mutated freely. */
function cloneMood(m: Mood): Mood {
  return { name: m.name, top: [...m.top], bottom: [...m.bottom], accentA: [...m.accentA], accentB: [...m.accentB] }
}

/**
 * Evolving abstract backdrop. A soft 4-corner gradient sets the mood while a
 * slowly drifting field of additive "nebula" orbs adds life and carries the
 * theme's accent colours. `setLevel` retargets the palette, which then eases in
 * over ~1s so transitions feel like a scene dissolving rather than a hard cut.
 */
export class Background {
  private readonly cur: Mood = cloneMood(MOODS[0])
  private target: Mood = MOODS[0]
  private readonly orbs: Orb[] = []
  private t = 0
  private spin = 0
  private pulse = 0 // brief bloom on level-up, decays to 0
  private level = 1

  constructor() {
    // A fixed, evenly-spread cloud of orbs. Positions reach well outside the
    // board footprint so the nebula wraps around the well on every side.
    const spreadX = COLS * CELL * 3.4
    const spreadY = ROWS * CELL * 1.7
    for (let i = 0; i < 15; i++) {
      const golden = i * 2.399963 // golden-angle scatter, avoids visible rows
      this.orbs.push({
        bx: Math.cos(golden) * spreadX * (0.35 + Math.random() * 0.65),
        by: Math.sin(golden * 1.3) * spreadY * (0.35 + Math.random() * 0.65),
        radius: CELL * (3.2 + Math.random() * 4.8),
        phase: Math.random() * Math.PI * 2,
        speed: 0.12 + Math.random() * 0.22,
        driftX: CELL * (1.4 + Math.random() * 2.6),
        driftY: CELL * (1.0 + Math.random() * 2.2),
        bias: Math.random()
      })
    }
  }

  /** Retarget the palette for a given level. Cheap; safe to call every frame. */
  public setLevel(level: number): void {
    if (level === this.level) return
    this.level = level
    this.target = MOODS[(level - 1) % MOODS.length]
    this.pulse = 1
  }

  /** Colour to clear the frame with — the theme's darkest tone, evolving too. */
  public clearColor(): RGB {
    return [this.cur.bottom[0] * 0.7, this.cur.bottom[1] * 0.7, this.cur.bottom[2] * 0.7]
  }

  public update(dt: number): void {
    this.t += dt
    this.spin += dt * 0.018
    this.pulse = Math.max(0, this.pulse - dt * 0.85)
    // Ease the live palette toward the target (frame-rate independent).
    const k = 1 - Math.exp(-dt * 1.1)
    this.cur.top = mix(this.cur.top, this.target.top, k)
    this.cur.bottom = mix(this.cur.bottom, this.target.bottom, k)
    this.cur.accentA = mix(this.cur.accentA, this.target.accentA, k)
    this.cur.accentB = mix(this.cur.accentB, this.target.accentB, k)
  }

  /**
   * Draw the backdrop. MUST be called before any lights are enabled this frame
   * so the unlit `fill()`s render at their literal colour; the caller is
   * expected to apply the scene lights only after this returns.
   */
  public draw(p: P5): void {
    this.drawGradient(p)
  }

  private drawGradient(p: P5): void {
    const { top, bottom, accentA, accentB } = this.cur
    // Faintly tint the top corners toward the two accents for a subtle,
    // asymmetric wash of colour; the floor stays near-black for contrast.
    const tl = mix(top, accentB, 0.14)
    const tr = mix(top, accentA, 0.14)
    const bl = mix(bottom, accentA, 0.05)
    const br = mix(bottom, accentB, 0.05)
    const W = 2600
    const H = 2000
    p.push()
    p.translate(0, 0, -560)
    p.noStroke()
    p.beginShape()
    p.fill(tl[0], tl[1], tl[2])
    p.vertex(-W, -H)
    p.fill(tr[0], tr[1], tr[2])
    p.vertex(W, -H)
    p.fill(br[0], br[1], br[2])
    p.vertex(W, H)
    p.fill(bl[0], bl[1], bl[2])
    p.vertex(-W, H)
    p.endShape(p.CLOSE)
    p.pop()
  }
}
