import { mix, type RGB } from '../core/color'
import type { PieceName } from '../engine'

/** The three tones every block is drawn with: body, bevelled cap, additive glow. */
export interface Shade {
  body: RGB
  face: RGB
  glow: RGB
}

/** Neutral tones for the board frame, backplate and grid. */
export interface Ink {
  wellFill: RGB
  wellEdge: RGB
  grid: RGB
  ghost: RGB
}

export interface ThemePreset {
  id: string
  name: string
  /** Accent used by the chrome (HUD values, banners, overlay titles). */
  accent: RGB
  pieces: Record<PieceName, Shade>
  ink: Ink
}

const WHITE: RGB = [255, 255, 255]

/**
 * Derive the cap and glow tones from a body colour, so a preset only has to
 * name seven base hues. The default theme still spells its shades out in full,
 * because its hand-tuned faces are a touch brighter than the formula gives.
 */
function shades(bodies: Record<PieceName, RGB>): Record<PieceName, Shade> {
  const out = {} as Record<PieceName, Shade>
  for (const name of Object.keys(bodies) as PieceName[]) {
    const body = bodies[name]
    out[name] = { body, face: mix(body, WHITE, 0.5), glow: mix(body, WHITE, 0.22) }
  }
  return out
}

export const THEMES: readonly ThemePreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    accent: [86, 200, 214],
    pieces: {
      I: { body: [56, 200, 214], face: [150, 244, 250], glow: [80, 220, 235] },
      O: { body: [232, 200, 84], face: [255, 238, 150], glow: [245, 214, 110] },
      T: { body: [170, 96, 214], face: [214, 158, 246], glow: [190, 120, 235] },
      S: { body: [104, 202, 118], face: [172, 240, 182], glow: [130, 224, 145] },
      Z: { body: [228, 92, 104], face: [255, 158, 166], glow: [240, 118, 128] },
      J: { body: [92, 122, 226], face: [158, 182, 252], glow: [120, 150, 240] },
      L: { body: [232, 150, 74], face: [255, 196, 138], glow: [244, 172, 104] }
    },
    ink: {
      wellFill: [14, 16, 24],
      wellEdge: [90, 104, 150],
      grid: [40, 48, 74],
      ghost: [180, 200, 235]
    }
  },
  {
    id: 'neon',
    name: 'Neon',
    accent: [255, 92, 210],
    pieces: shades({
      I: [0, 240, 255],
      O: [255, 232, 0],
      T: [255, 60, 200],
      S: [64, 255, 140],
      Z: [255, 48, 96],
      J: [80, 96, 255],
      L: [255, 150, 0]
    }),
    ink: {
      wellFill: [10, 6, 20],
      wellEdge: [180, 70, 220],
      grid: [64, 28, 96],
      ghost: [255, 190, 255]
    }
  },
  {
    id: 'pastel',
    name: 'Pastel',
    accent: [150, 205, 230],
    pieces: shades({
      I: [140, 214, 226],
      O: [240, 224, 158],
      T: [196, 166, 226],
      S: [166, 220, 178],
      Z: [232, 158, 166],
      J: [158, 176, 226],
      L: [238, 190, 150]
    }),
    ink: {
      wellFill: [26, 28, 38],
      wellEdge: [130, 140, 170],
      grid: [58, 64, 84],
      ghost: [210, 220, 240]
    }
  },
  {
    id: 'mono',
    name: 'Mono',
    accent: [220, 226, 240],
    pieces: shades({
      I: [232, 236, 246],
      O: [200, 206, 220],
      T: [168, 175, 192],
      S: [140, 148, 166],
      Z: [112, 120, 140],
      J: [88, 96, 116],
      L: [186, 192, 208]
    }),
    ink: {
      wellFill: [12, 13, 16],
      wellEdge: [110, 116, 130],
      grid: [44, 47, 56],
      ghost: [220, 224, 234]
    }
  },
  {
    id: 'ember',
    name: 'Ember',
    accent: [255, 160, 80],
    pieces: shades({
      I: [255, 186, 96],
      O: [255, 220, 130],
      T: [214, 92, 78],
      S: [196, 170, 92],
      Z: [176, 52, 60],
      J: [140, 78, 62],
      L: [246, 132, 46]
    }),
    ink: {
      wellFill: [22, 12, 10],
      wellEdge: [150, 88, 62],
      grid: [70, 42, 32],
      ghost: [250, 210, 170]
    }
  }
]

export const DEFAULT_THEME = THEMES[0]

/**
 * Fixed neutral shade for garbage blocks (see `Field.addGarbage`) — deliberately
 * theme-independent, so garbage always reads as "not a piece" regardless of the
 * active palette.
 */
export const GARBAGE_SHADE: Shade = {
  body: [104, 108, 118],
  face: [156, 160, 170],
  glow: [130, 134, 144]
}

/**
 * The live palette. Everything that paints a block reads through these objects,
 * and {@link applyTheme} rewrites them *in place* — so swapping themes at
 * runtime needs no re-import, re-wiring or restart of the sketch.
 */
export const PALETTE: Record<PieceName, Shade> = structuredClone(DEFAULT_THEME.pieces) as Record<PieceName, Shade>

export const INK: Ink = structuredClone(DEFAULT_THEME.ink) as Ink

/** Live chrome accent, mutated by {@link applyTheme} for the same reason. */
export const UI: { accent: RGB } = { accent: [...DEFAULT_THEME.accent] }

export function findTheme(id: string): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME
}

/** Point the live palette at a preset. Safe to call at any time. */
export function applyTheme(id: string): ThemePreset {
  const theme = findTheme(id)
  for (const name of Object.keys(theme.pieces) as PieceName[]) {
    const src = theme.pieces[name]
    PALETTE[name].body = [...src.body]
    PALETTE[name].face = [...src.face]
    PALETTE[name].glow = [...src.glow]
  }
  INK.wellFill = [...theme.ink.wellFill]
  INK.wellEdge = [...theme.ink.wellEdge]
  INK.grid = [...theme.ink.grid]
  INK.ghost = [...theme.ink.ghost]
  UI.accent = [...theme.accent]
  return theme
}
