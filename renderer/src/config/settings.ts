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

export interface SettingsState {
  theme: string
  keys: Keymap
}

const STORAGE_KEY = 'tetris.ts:settings'

function load(): SettingsState {
  const fallback: SettingsState = { theme: DEFAULT_THEME.id, keys: structuredClone(DEFAULT_KEYS) }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<SettingsState>
    const keys = structuredClone(DEFAULT_KEYS)
    for (const bind of BINDS) {
      const list = saved.keys?.[bind]
      // Only trust well-formed arrays of strings; anything else falls back to
      // the default binding for that action rather than poisoning the map.
      if (Array.isArray(list) && list.every((k) => typeof k === 'string')) {
        keys[bind] = list.map(normalizeKey)
      }
    }
    return { theme: findTheme(saved.theme ?? '').id, keys }
  } catch {
    return fallback
  }
}

type Listener = (state: SettingsState) => void

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

  public setTheme(id: string): void {
    this.state.theme = findTheme(id).id
    applyTheme(this.state.theme)
    this.commit()
  }

  /**
   * Bind `key` to `bind` as its only key, stealing it from any other action
   * that already claimed it — two actions sharing a key would make the input
   * layer ambiguous.
   */
  public bind(bind: Bind, key: string): void {
    const k = normalizeKey(key)
    for (const other of BINDS) {
      if (other === bind) continue
      this.state.keys[other] = this.state.keys[other].filter((x) => x !== k)
    }
    this.state.keys[bind] = [k]
    this.commit()
  }

  public reset(): void {
    this.state = { theme: DEFAULT_THEME.id, keys: structuredClone(DEFAULT_KEYS) }
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
