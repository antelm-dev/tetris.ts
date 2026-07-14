import { BINDS, DEFAULT_KEYS, normalizeKey, type Bind, type Keymap } from './keymap'
import { applyTheme, DEFAULT_THEME, findTheme, type ThemePreset } from './themes'

/**
 * The user's settings — the visual theme and the key bindings — and their
 * persistence. Backed by `localStorage` (the renderer owns them entirely, no
 * IPC round-trip) and applied on import, so the very first frame already
 * reflects the saved choice.
 *
 * The shape of a binding lives in `keymap.ts`; this module only stores which
 * ones the user picked.
 */

/**
 * `'auto'` follows the OS `prefers-reduced-motion` query; `'on'`/`'off'` are an
 * explicit user override that no longer tracks the OS setting.
 */
export type ReducedMotionPref = 'auto' | 'on' | 'off'

export interface ComfortSettings {
  reducedMotion: ReducedMotionPref
  /** 0–1 multiplier on screen-shake trauma. */
  screenShakeIntensity: number
  /** 0–1 multiplier on particle counts. */
  effectsIntensity: number
  /** Keep the start-of-run control hint visible instead of letting it fade. */
  persistentHints: boolean
}

export const DEFAULT_COMFORT: ComfortSettings = {
  reducedMotion: 'auto',
  screenShakeIntensity: 1,
  effectsIntensity: 1,
  persistentHints: false
}

export interface SettingsState extends ComfortSettings {
  theme: string
  keys: Keymap
}

const STORAGE_KEY = 'tetris.ts:settings'

const REDUCED_MOTION_PREFS = new Set<ReducedMotionPref>(['auto', 'on', 'off'])

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function parseComfort(record: { [K in keyof ComfortSettings]?: unknown }): ComfortSettings {
  const reducedMotion =
    typeof record.reducedMotion === 'string' && REDUCED_MOTION_PREFS.has(record.reducedMotion as ReducedMotionPref)
      ? (record.reducedMotion as ReducedMotionPref)
      : DEFAULT_COMFORT.reducedMotion
  const intensity = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback
  return {
    reducedMotion,
    screenShakeIntensity: intensity(record.screenShakeIntensity, DEFAULT_COMFORT.screenShakeIntensity),
    effectsIntensity: intensity(record.effectsIntensity, DEFAULT_COMFORT.effectsIntensity),
    persistentHints:
      typeof record.persistentHints === 'boolean' ? record.persistentHints : DEFAULT_COMFORT.persistentHints
  }
}

export function parseSettings(raw: string | null): SettingsState {
  const fallback: SettingsState = { theme: DEFAULT_THEME.id, keys: structuredClone(DEFAULT_KEYS), ...DEFAULT_COMFORT }
  if (!raw) return fallback
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback
    const record = saved as { theme?: unknown; keys?: unknown } & { [K in keyof ComfortSettings]?: unknown }
    const keys = structuredClone(DEFAULT_KEYS)
    const savedKeys = record.keys
    if (savedKeys && typeof savedKeys === 'object' && !Array.isArray(savedKeys)) {
      for (const bind of BINDS) {
        const list = (savedKeys as Partial<Record<Bind, unknown>>)[bind]
        // Only trust well-formed arrays of strings; anything else falls back to
        // the default binding for that action rather than poisoning the map.
        if (Array.isArray(list) && list.every((k) => typeof k === 'string')) {
          keys[bind] = list.map(normalizeKey)
        }
      }
    }
    const themeId = typeof record.theme === 'string' ? record.theme : ''
    return { theme: findTheme(themeId).id, keys, ...parseComfort(record) }
  } catch {
    return fallback
  }
}

function load(): SettingsState {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY))
  } catch {
    return parseSettings(null)
  }
}

type Listener = (state: SettingsState) => void

// Constructed once; `reducedMotionActive` reads `.matches` live every call, so
// an OS-level change while the pref is `'auto'` is picked up on the very next
// frame with no listener wiring. `typeof matchMedia` is a safe check even when
// the identifier doesn't exist at all (e.g. under vitest's node environment).
const reducedMotionMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined

class SettingsStore {
  private state: SettingsState = load()
  private readonly listeners = new Set<Listener>()

  constructor() {
    applyTheme(this.state.theme)
  }

  public get theme(): ThemePreset {
    return findTheme(this.state.theme)
  }

  public get keys(): Keymap {
    return this.state.keys
  }

  public keysFor(bind: Bind): string[] {
    return this.state.keys[bind]
  }

  public get reducedMotion(): ReducedMotionPref {
    return this.state.reducedMotion
  }

  /** Whether motion should actually be reduced right now — resolves `'auto'` against the OS preference. */
  public get reducedMotionActive(): boolean {
    return this.state.reducedMotion === 'auto' ? (reducedMotionMQ?.matches ?? false) : this.state.reducedMotion === 'on'
  }

  public get screenShakeIntensity(): number {
    return this.state.screenShakeIntensity
  }

  public get effectsIntensity(): number {
    return this.state.effectsIntensity
  }

  public get persistentHints(): boolean {
    return this.state.persistentHints
  }

  /** Screen-shake multiplier that also honours reduced motion (fully off, not just dampened). */
  public get shakeMultiplier(): number {
    return this.reducedMotionActive ? 0 : this.state.screenShakeIntensity
  }

  public setTheme(id: string): void {
    this.state.theme = findTheme(id).id
    applyTheme(this.state.theme)
    this.commit()
  }

  public setReducedMotion(pref: ReducedMotionPref): void {
    this.state.reducedMotion = pref
    this.commit()
  }

  public setScreenShakeIntensity(v: number): void {
    this.state.screenShakeIntensity = clamp01(v)
    this.commit()
  }

  public setEffectsIntensity(v: number): void {
    this.state.effectsIntensity = clamp01(v)
    this.commit()
  }

  public setPersistentHints(v: boolean): void {
    this.state.persistentHints = v
    this.commit()
  }

  /**
   * Bind `key` to `bind` as its only key, stealing it from any other action
   * that already claimed it — two actions sharing a key would make the input
   * layer ambiguous. Reports which action (if any) lost the key, so the
   * caller can explain the steal to the player.
   */
  public bind(bind: Bind, key: string): { stolenFrom?: Bind } {
    const k = normalizeKey(key)
    let stolenFrom: Bind | undefined
    for (const other of BINDS) {
      if (other === bind) continue
      if (this.state.keys[other].includes(k)) {
        stolenFrom = other
        this.state.keys[other] = this.state.keys[other].filter((x) => x !== k)
      }
    }
    this.state.keys[bind] = [k]
    this.commit()
    return { stolenFrom }
  }

  public reset(): void {
    this.state = { theme: DEFAULT_THEME.id, keys: structuredClone(DEFAULT_KEYS), ...DEFAULT_COMFORT }
    applyTheme(this.state.theme)
    this.commit()
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private commit(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // Persistence is a nicety — a full/blocked store must not break the game.
    }
    for (const fn of this.listeners) fn(this.state)
  }
}

export const settings = new SettingsStore()
