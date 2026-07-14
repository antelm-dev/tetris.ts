import { describe, it, expect } from 'vitest'
import { isAllowedExternalUrl } from '../../main/core/external-url'

describe('isAllowedExternalUrl', () => {
  it('allows https and mailto', () => {
    expect(isAllowedExternalUrl('https://example.com/path')).toBe(true)
    expect(isAllowedExternalUrl('mailto:dev@example.com')).toBe(true)
  })

  it('rejects unexpected protocols and malformed URLs', () => {
    expect(isAllowedExternalUrl('http://example.com')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/secret')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,hi')).toBe(false)
    expect(isAllowedExternalUrl('custom://app')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
    expect(isAllowedExternalUrl('')).toBe(false)
  })
})
