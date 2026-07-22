import type P5 from 'p5'

/**
 * Composite a full-window 2D buffer over the WEBGL scene: unlit, so the scene
 * lights don't tint it, and depth-test-free, so it lands above everything.
 */
export function composite(p: P5, g: P5.Graphics): void {
  const gl = p.drawingContext as WebGLRenderingContext
  p.push()
  p.noLights()
  gl.disable(gl.DEPTH_TEST)
  p.imageMode(p.CORNER)
  p.image(g, -p.width / 2, -p.height / 2, p.width, p.height)
  gl.enable(gl.DEPTH_TEST)
  p.pop()
}

/** Create/resize a buffer to match the canvas. */
export function ensureBuffer(p: P5, current: P5.Graphics | undefined, w: number, h: number): P5.Graphics {
  if (!current) return p.createGraphics(w, h)
  if (current.width !== w || current.height !== h) current.resizeCanvas(w, h)
  return current
}

/**
 * Clip subsequent drawing to a rect in the graphics' current local space (so
 * it composes correctly under an existing translate/scale). Pair with
 * {@link unclip}; internally just a `push()`/`pop()` with a canvas clip path,
 * since p5's 2D renderer saves/restores the clip region like any other state.
 */
export function clipRect(g: P5.Graphics, x: number, y: number, w: number, h: number): void {
  g.push()
  const ctx = g.drawingContext as CanvasRenderingContext2D
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
}

/** Undo the clip pushed by {@link clipRect}. */
export function unclip(g: P5.Graphics): void {
  g.pop()
}
