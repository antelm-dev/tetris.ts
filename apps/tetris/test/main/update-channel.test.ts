import { describe, it, expect } from 'vitest'
import { updateChannelForVersion } from '../../main/core/update-channel'

describe('updateChannelForVersion', () => {
  it('keeps beta builds on the beta feed', () => {
    expect(updateChannelForVersion('1.2.0-beta')).toBe('beta')
    expect(updateChannelForVersion('1.2.0-beta.3')).toBe('beta')
  })

  it('keeps everything else on the stable feed', () => {
    expect(updateChannelForVersion('1.2.0')).toBe('latest')
    expect(updateChannelForVersion('1.2.0-rc.1')).toBe('latest')
    // Not a prerelease tag — a version merely containing "beta" stays stable.
    expect(updateChannelForVersion('1.2.0-betamax')).toBe('latest')
  })
})
