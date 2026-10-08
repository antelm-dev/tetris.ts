import { describe, expect, it } from 'vitest'
import type { AssetItem, AssetTypeSummary } from '../server/types'
import {
  assetUrl,
  formatBytes,
  formatDuration,
  friendlyName,
  hasAcceptedExtension,
  typeFilters,
  visibleItems
} from '../src/format'

function item(name: string, extra: Partial<AssetItem> = {}): AssetItem {
  return { name, bytes: 1, updatedAt: '2026-01-01T00:00:00.000Z', filter: 'sfx', badge: 'SFX', ...extra }
}

describe('friendlyName', () => {
  it('strips prefixes and extensions and splits words', () => {
    expect(friendlyName('SFX_PieceHardDrop.ogg')).toBe('Piece Hard Drop')
    expect(friendlyName('VO_20sec.ogg')).toBe('20sec')
    expect(friendlyName('level2Start_final.png')).toBe('level2 Start final')
    expect(friendlyName('A1.ogg')).toBe('A 1')
  })
})

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(5120)).toBe('5.0 KB')
    expect(formatBytes(8 * 1024 * 1024)).toBe('8 MB')
  })
})

describe('formatDuration', () => {
  it('uses tenths below ten seconds and m:ss above', () => {
    expect(formatDuration(4.24)).toBe('4.2s')
    expect(formatDuration(65.4)).toBe('1:05')
    expect(formatDuration(59.6)).toBe('1:00')
  })
})

describe('hasAcceptedExtension', () => {
  it('matches listed extensions case-insensitively', () => {
    expect(hasAcceptedExtension('.ogg,audio/ogg', 'Track.OGG')).toBe(true)
    expect(hasAcceptedExtension('.png', 'icon.png')).toBe(true)
  })

  it('rejects other, partial and missing extensions', () => {
    expect(hasAcceptedExtension('.ogg', 'track.mp3')).toBe(false)
    expect(hasAcceptedExtension('.ogg', 'track.og')).toBe(false)
    expect(hasAcceptedExtension('.ogg', 'ogg')).toBe(false)
  })
})

describe('typeFilters', () => {
  const type = (items: AssetItem[]): AssetTypeSummary => ({
    id: 'sounds',
    label: 'Sounds',
    singular: 'sound',
    description: '',
    accept: '.ogg',
    preview: 'audio',
    maxBytes: 1,
    filters: [{ id: 'all', label: 'All' }],
    count: items.length,
    items
  })

  it('adds Unused only when the server reports usage', () => {
    expect(typeFilters(type([item('a.ogg')])).map((filter) => filter.id)).toEqual(['all'])
    expect(typeFilters(type([item('a.ogg', { used: true })])).map((filter) => filter.id)).toEqual(['all', 'unused'])
  })
})

describe('visibleItems', () => {
  const items = [
    item('SFX_Hold.ogg', { used: true }),
    item('SFX_Drop.ogg', { used: false }),
    item('VO_Go.ogg', { filter: 'voice', used: true })
  ]
  const names = (list: AssetItem[]): string[] => list.map((entry) => entry.name)

  it('filters by type filter, unused, and query', () => {
    expect(names(visibleItems(items, 'all', ''))).toHaveLength(3)
    expect(names(visibleItems(items, 'voice', ''))).toEqual(['VO_Go.ogg'])
    expect(names(visibleItems(items, 'unused', ''))).toEqual(['SFX_Drop.ogg'])
    expect(names(visibleItems(items, 'all', '  HOLD '))).toEqual(['SFX_Hold.ogg'])
    expect(names(visibleItems(items, 'voice', 'hold'))).toEqual([])
  })
})

describe('assetUrl', () => {
  it('encodes segments and busts the cache with updatedAt', () => {
    expect(assetUrl('sounds', item('a b.ogg'))).toBe('/api/assets/sounds/a%20b.ogg?v=2026-01-01T00%3A00%3A00.000Z')
  })
})
