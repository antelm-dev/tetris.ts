/** An 8-bit RGB triple. The only colour representation the renderer uses. */
export type RGB = [number, number, number]

/** Linear blend from `a` to `b`, `t` in [0, 1]. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
