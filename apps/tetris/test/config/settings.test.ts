import { describe, it, expect } from 'vitest'
import { DEFAULT_AUDIO, DEFAULT_COMFORT, parseSettings, settings } from '@tetris/renderer/config/settings'
import { DEFAULT_KEYS } from '@tetris/renderer/config/keymap'
import { DEFAULT_THEME } from '@tetris/renderer/config/themes'

describe('parseSettings', () => {
  it('returns defaults for null or empty storage', () => {
    expect(parseSettings(null)).toEqual({
      theme: DEFAULT_THEME.id,
      keys: DEFAULT_KEYS,
      ...DEFAULT_COMFORT,
      ...DEFAULT_AUDIO
    })
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
    expect(parsed.das).toBe(150)
    expect(parsed.arr).toBe(38)
    expect(parsed.ghost).toBe(true)
    expect(parsed.vibration).toBe(true)
    expect(parsed.touchControls).toBe('auto')
    expect(parsed.touchLayout).toBe('split')
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

  it('validates gameplay timing and touch preferences', () => {
    const parsed = parseSettings(
      JSON.stringify({ das: 999, arr: 0, ghost: false, vibration: false, touchControls: 'on', touchLayout: 'right' })
    )
    expect(parsed.das).toBe(300)
    expect(parsed.arr).toBe(10)
    expect(parsed.ghost).toBe(false)
    expect(parsed.vibration).toBe(false)
    expect(parsed.touchControls).toBe('on')
    expect(parsed.touchLayout).toBe('right')
  })
})

describe('parseSettings — audio settings', () => {
  it('defaults every audio field when storage has none', () => {
    const parsed = parseSettings(JSON.stringify({ theme: DEFAULT_THEME.id, keys: {} }))
    expect(parsed.musicVolume).toBe(0.7)
    expect(parsed.effectsVolume).toBe(0.9)
    expect(parsed.muted).toBe(false)
  })

  it('defaults audio fields that are missing or the wrong type, without disturbing the rest', () => {
    const parsed = parseSettings(JSON.stringify({ musicVolume: 'loud', muted: 'yes', effectsIntensity: 0.5 }))
    expect(parsed.musicVolume).toBe(DEFAULT_AUDIO.musicVolume)
    expect(parsed.effectsVolume).toBe(DEFAULT_AUDIO.effectsVolume)
    expect(parsed.muted).toBe(false)
    expect(parsed.effectsIntensity).toBe(0.5)
  })

  it('clamps out-of-range volumes to 0–1', () => {
    const parsed = parseSettings(JSON.stringify({ musicVolume: 5, effectsVolume: -2 }))
    expect(parsed.musicVolume).toBe(1)
    expect(parsed.effectsVolume).toBe(0)
  })

  it('accepts well-formed audio values as-is', () => {
    const parsed = parseSettings(JSON.stringify({ musicVolume: 0.3, effectsVolume: 0.6, muted: true }))
    expect(parsed.musicVolume).toBe(0.3)
    expect(parsed.effectsVolume).toBe(0.6)
    expect(parsed.muted).toBe(true)
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
    settings.setDas(250)
    settings.setArr(75)
    settings.setGhost(false)
    settings.setVibration(false)
    settings.setTouchControls('on')
    settings.setTouchLayout('right')

    settings.reset()

    expect(settings.theme.id).toBe(DEFAULT_THEME.id)
    expect(settings.keys).toEqual(DEFAULT_KEYS)
    expect(settings.reducedMotion).toBe('auto')
    expect(settings.screenShakeIntensity).toBe(1)
    expect(settings.effectsIntensity).toBe(1)
    expect(settings.persistentHints).toBe(false)
    expect(settings.das).toBe(150)
    expect(settings.arr).toBe(38)
    expect(settings.ghost).toBe(true)
    expect(settings.vibration).toBe(true)
    expect(settings.touchControls).toBe('auto')
    expect(settings.touchLayout).toBe('split')
    expect(settings.musicVolume).toBe(DEFAULT_AUDIO.musicVolume)
    expect(settings.effectsVolume).toBe(DEFAULT_AUDIO.effectsVolume)
    expect(settings.muted).toBe(false)
  })

  it('clamps volumes set out of range', () => {
    settings.reset()
    settings.setMusicVolume(2)
    settings.setEffectsVolume(-1)
    expect(settings.musicVolume).toBe(1)
    expect(settings.effectsVolume).toBe(0)
  })

  it('mute/unmute never disturbs the stored volumes', () => {
    settings.reset()
    settings.setMusicVolume(0.42)
    settings.setEffectsVolume(0.13)

    settings.setMuted(true)
    expect(settings.muted).toBe(true)
    expect(settings.musicVolume).toBe(0.42)
    expect(settings.effectsVolume).toBe(0.13)

    settings.setMuted(false)
    expect(settings.muted).toBe(false)
    expect(settings.musicVolume).toBe(0.42)
    expect(settings.effectsVolume).toBe(0.13)
  })

  it('notifies subscribers immediately when an audio setting changes', () => {
    settings.reset()
    const seen: number[] = []
    const unsubscribe = settings.subscribe((s) => seen.push(s.musicVolume))
    settings.setMusicVolume(0.55)
    unsubscribe()
    expect(seen).toEqual([0.55])
  })
})
