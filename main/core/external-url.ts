/**
 * Decide whether a URL from `setWindowOpenHandler` may be passed to
 * `shell.openExternal`. Only well-formed https and mailto links are allowed.
 */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}
