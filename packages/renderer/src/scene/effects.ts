import type P5 from 'p5'
import type { RGB } from '../core/color'

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  ttl: number
  size: number
  color: RGB
}

/**
 * Small self-contained juice layer: additive spark particles plus a decaying
 * screen-shake trauma value. Everything is time-based (driven by `dt` in
 * seconds) so it behaves identically regardless of frame rate.
 */
export class Effects {
  private particles: Particle[] = []
  private trauma = 0
  private shakeSeed = Math.random() * 1000

  /** Add camera trauma (0–1). Shake magnitude scales with trauma². */
  public shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  /** Emit a burst of `count` sparks from a world position. */
  public burst(x: number, y: number, count: number, color: RGB, spread = 220): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const s = spread * (0.3 + Math.random() * 0.7)
      const ttl = 0.4 + Math.random() * 0.6
      this.particles.push({
        x,
        y,
        z: (Math.random() - 0.5) * 20,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        vz: (Math.random() - 0.5) * 160,
        life: ttl,
        ttl,
        size: 3 + Math.random() * 5,
        color
      })
    }
  }

  /** Spray sparks along a horizontal line (used for line clears). */
  public line(y: number, halfWidth: number, color: RGB, count = 46): void {
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 2 - 1) * halfWidth
      const ttl = 0.35 + Math.random() * 0.55
      this.particles.push({
        x,
        y: y + (Math.random() - 0.5) * 12,
        z: (Math.random() - 0.5) * 24,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 260,
        vz: (Math.random() - 0.5) * 200,
        life: ttl,
        ttl,
        size: 3 + Math.random() * 6,
        color
      })
    }
  }

  public update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.6)
    for (const part of this.particles) {
      part.life -= dt
      part.vy += 520 * dt // gravity
      part.x += part.vx * dt
      part.y += part.vy * dt
      part.z += part.vz * dt
    }
    this.particles = this.particles.filter((par) => par.life > 0)
  }

  /** Apply the current shake as a translation. Call inside a push()/pop(). */
  public applyShake(p: P5): void {
    if (this.trauma <= 0) return
    const mag = this.trauma * this.trauma * 26
    const t = p.frameCount * 0.9 + this.shakeSeed
    p.translate(Math.sin(t * 1.7) * mag, Math.cos(t * 2.3) * mag, 0)
  }

  /** Draw the live particles as additive, glowing quads. */
  public draw(p: P5): void {
    if (this.particles.length === 0) return
    p.push()
    p.noStroke()
    p.blendMode(p.ADD)
    for (const part of this.particles) {
      const k = part.life / part.ttl
      p.push()
      p.translate(part.x, part.y, part.z)
      p.fill(part.color[0], part.color[1], part.color[2], 255 * k)
      p.plane(part.size * (0.5 + k), part.size * (0.5 + k))
      p.pop()
    }
    p.blendMode(p.BLEND)
    p.pop()
  }

  public get active(): boolean {
    return this.particles.length > 0 || this.trauma > 0
  }
}
