/** Collects every filename with one of `extensions` (e.g. `.ogg`) cited anywhere in `text`. */
export function referencedNames(text: string, extensions: string[]): Set<string> {
  if (extensions.length === 0) return new Set()
  const suffixes = extensions.map((extension) => extension.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`[A-Za-z0-9_.-]+\\.(?:${suffixes.join('|')})\\b`, 'gi')
  return new Set(text.match(pattern) ?? [])
}
