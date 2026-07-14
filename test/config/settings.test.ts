import { describe, it, expect } from 'vitest'
import { DEFAULT_COMFORT, parseSettings, settings } from '../../renderer/src/config/settings'
import { DEFAULT_KEYS } from '../../renderer/src/config/keymap'
import { DEFAULT_THEME } from '../../renderer/src/config/themes'

describe('parseSettings', () => {
  it('returns defaults for null or empty storage', () => {
    expect(parseSettings(null)).toEqual({ theme: DEFAULT_THEME.id, keys: DEFAULT_KEYS, ...DEFAULT_COMFORT })
  })

  it('recovers from malformed JSON', () => {
    expect(parseSettings('{not json').theme).toBe(DEFAULT_THEME.id)
    expect(parseSettings('[]').keys).toEqual(DEFAULT_KEYS)
    expect(parseSettings('"string"').keys).toEqual(DEFAULT_KEYS)
  })

  it('ignores incomplete or poisoned key bindings', () => {
    const parsed = parseSettings(
      JSON.stringify({
        theme: DEFAULT_THEME.id,
        keys: { left: ['a'], softDrop: 'down', hardDrop: [1, 2] }
      })
    )
    expect(parsed.keys.left).toEqual(['a'])
    expect(parsed.keys.softDrop).toEqual(DEFAULT_KEYS.softDrop)
    expect(parsed.keys.hardDrop).toEqual(DEFAULT_KEYS.hardDrop)
    expect(parsed.keys.right).toEqual(DEFAULT_KEYS.right)
  })

  it('falls back when theme is missing or unknown', () => {
    expect(parseSettings(JSON.stringify({ keys: {} })).theme).toBe(DEFAULT_THEME.id)
    expect(parseSettings(JSON.stringify({ theme: 12 })).theme).toBe(DEFAULT_THEME.id)
    expect(parseSettings(JSON.stringify({ theme: 'nope-not-real' })).theme).toBe(DEFAULT_THEME.id)
  })
})

describe('parseSettings — comfort settings', () => {
  it('defaults every comfort field when storage has none', () => {
    const parsed = parseSettings(JSON.stringify({ theme: DEFAULT_THEME.id, keys: {} }))
    expect(parsed.reducedMotion).toBe('auto')
    expect(parsed.screenShakeIntensity).toBe(1)
    expect(parsed.effectsIntensity).toBe(1)
    expect(parsed.persistentHints).toBe(false)
  })

  it('recovers from malformed or out-of-range comfort fields', () => {
    const parsed = parseSettings(
      JSON.stringify({
        reducedMotion: 'nonsense',
        screenShakeIntensity: 5,
        effectsIntensity: -3,
        persistentHints: 'yes'
      })
    )
    expect(parsed.reducedMotion).toBe('auto')
    expect(parsed.screenShakeIntensity).toBe(1) // clamped from 5
    expect(parsed.effectsIntensity).toBe(0) // clamped from -3
    expect(parsed.persistentHints).toBe(false) // wrong type falls back
  })

  it('accepts well-formed comfort values as-is', () => {
    const parsed = parseSettings(
      JSON.stringify({ reducedMotion: 'on', screenShakeIntensity: 0.4, effectsIntensity: 0.7, persistentHints: true })
    )
    expect(parsed.reducedMotion).toBe('on')
    expect(parsed.screenShakeIntensity).toBe(0.4)
    expect(parsed.effectsIntensity).toBe(0.7)
    expect(parsed.persistentHints).toBe(true)
  })
})

describe('SettingsStore', () => {
  it('bind() reports which action lost a stolen key', () => {
    settings.reset()
    // 'a' is bound to `left` by default (DEFAULT_KEYS.left = ['ArrowLeft', 'a']).
    const result = settings.bind('right', 'a')
    expect(result.stolenFrom).toBe('left')
    expect(settings.keysFor('right')).toEqual(['a'])
    expect(settings.keysFor('left')).toEqual(['ArrowLeft'])
  })

  it('bind() reports no steal when the key was previously unbound', () => {
    settings.reset()
    const result = settings.bind('left', 'q')
    expect(result.stolenFrom).toBeUndefined()
    expect(settings.keysFor('left')).toEqual(['q'])
  })

  it('reset() restores comfort settings alongside theme and keys', () => {
    settings.setTheme('neon')
    settings.bind('left', 'q')
    settings.setReducedMotion('on')
    settings.setScreenShakeIntensity(0.2)
    settings.setEffectsIntensity(0.3)
    settings.setPersistentHints(true)

    settings.reset()

    expect(settings.theme.id).toBe(DEFAULT_THEME.id)
    expect(settings.keys).toEqual(DEFAULT_KEYS)
    expect(settings.reducedMotion).toBe('auto')
    expect(settings.screenShakeIntensity).toBe(1)
    expect(settings.effectsIntensity).toBe(1)
    expect(settings.persistentHints).toBe(false)
  })
})
