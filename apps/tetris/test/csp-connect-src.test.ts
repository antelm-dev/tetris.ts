import { describe, expect, it } from 'vitest'
import { cspConnectSrc } from '../csp-connect-src'

describe('cspConnectSrc', () => {
  it('defaults to same-origin only', () => {
    expect(cspConnectSrc(undefined)).toBe("'self'")
    expect(cspConnectSrc('')).toBe("'self'")
    expect(cspConnectSrc('   ')).toBe("'self'")
  })

  it('allows http API origin and matching ws', () => {
    expect(cspConnectSrc('http://localhost:3000')).toBe(
      "'self' http://localhost:3000 ws://localhost:3000"
    )
  })

  it('allows https API origin and matching wss', () => {
    expect(cspConnectSrc('https://api.example.com/v1')).toBe(
      "'self' https://api.example.com wss://api.example.com"
    )
  })

  it('ignores invalid origins', () => {
    expect(cspConnectSrc('not a url')).toBe("'self'")
  })
})
