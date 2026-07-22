import { describe, expect, it } from 'vitest'
import { loadConfig } from './env.schema'

const base = { JWT_SECRET: 'a-sufficiently-long-secret' }

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    const config = loadConfig({ ...base })
    expect(config.nodeEnv).toBe('development')
    expect(config.http.host).toBe('0.0.0.0')
    expect(config.http.port).toBe(3000)
    expect(config.realtime.namespace).toBe('/game')
    expect(config.realtime.roomMaxPlayers).toBe(100)
  })

  it('rejects a too-short JWT secret', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/16 characters/)
  })

  it('coerces the port and clamps room capacity within range', () => {
    const config = loadConfig({ ...base, API_PORT: '8080', ROOM_MAX_PLAYERS: '64' })
    expect(config.http.port).toBe(8080)
    expect(config.realtime.roomMaxPlayers).toBe(64)
  })

  it('parses CORS origins: list, wildcard and empty', () => {
    expect(loadConfig({ ...base, CORS_ORIGINS: 'http://a.com, http://b.com' }).http.corsOrigins).toEqual([
      'http://a.com',
      'http://b.com'
    ])
    expect(loadConfig({ ...base, CORS_ORIGINS: '*' }).http.corsOrigins).toBe(true)
    expect(loadConfig({ ...base, CORS_ORIGINS: '' }).http.corsOrigins).toBe(false)
  })
})
