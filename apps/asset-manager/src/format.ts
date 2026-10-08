import type { AssetFilter, AssetItem, AssetTypeSummary } from '../server/types'

export function friendlyName(filename: string): string {
  return filename
    .replace(/^(SFX|VO)_/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replaceAll('_', ' ')
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function formatDuration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Whether `filename`'s extension is listed in an `accept` string such as `.ogg,audio/ogg`. */
export function hasAcceptedExtension(accept: string, filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return false
  const extension = filename.slice(dot).toLowerCase()
  return accept
    .toLowerCase()
    .split(',')
    .some((entry) => entry.trim() === extension)
}

/** The type's filters, plus a client-side "Unused" filter when the server reports usage. */
export function typeFilters(type: AssetTypeSummary): AssetFilter[] {
  return type.items.some((asset) => asset.used !== undefined)
    ? [...type.filters, { id: 'unused', label: 'Unused' }]
    : type.filters
}

export function visibleItems(items: AssetItem[], filter: string, query: string): AssetItem[] {
  const needle = query.trim().toLowerCase()
  return items.filter(
    (asset) =>
      (filter === 'all' || asset.filter === filter || (filter === 'unused' && asset.used === false)) &&
      asset.name.toLowerCase().includes(needle)
  )
}

export function assetEndpoint(typeId: string, name: string): string {
  return `/api/assets/${encodeURIComponent(typeId)}/${encodeURIComponent(name)}`
}

/** `?v=updatedAt` busts the browser cache after a replacement. */
export function assetUrl(typeId: string, asset: AssetItem): string {
  return `${assetEndpoint(typeId, asset.name)}?v=${encodeURIComponent(asset.updatedAt)}`
}
