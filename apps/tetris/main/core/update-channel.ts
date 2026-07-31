export type UpdateChannel = 'latest' | 'beta'

/**
 * Beta installers stay on the beta feed; ordinary versions only consume stable
 * releases. A beta feed can still promote a stable release, so a beta build is
 * never stranded on a dead channel.
 */
export function updateChannelForVersion(version: string): UpdateChannel {
  return /-beta(?:\.|$)/.test(version) ? 'beta' : 'latest'
}
