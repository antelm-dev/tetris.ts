import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAssetStore, type AssetStoreError } from '../server/asset-store.mjs'

let root: string
let sourceDir: string
let mirrorDir: string

const ogg = (marker: number): Buffer => Buffer.from([0x4f, 0x67, 0x67, 0x53, marker])

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tetris-assets-'))
  sourceDir = join(root, 'source')
  mirrorDir = join(root, 'mirror')
  await Promise.all([mkdir(sourceDir), mkdir(mirrorDir)])
  await Promise.all([
    writeFile(join(sourceDir, 'SFX_Move.ogg'), ogg(1)),
    writeFile(join(mirrorDir, 'SFX_Move.ogg'), ogg(1)),
    writeFile(join(sourceDir, 'VO_WOW.ogg'), ogg(2)),
    writeFile(join(mirrorDir, 'VO_WOW.ogg'), ogg(2))
  ])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function store() {
  return createAssetStore([
    {
      id: 'sounds',
      label: 'Sounds',
      singular: 'sound',
      description: 'Test sounds',
      sourceDir,
      mirrors: [mirrorDir],
      extensions: ['.ogg'],
      accept: '.ogg',
      contentType: 'audio/ogg',
      preview: 'audio',
      maxBytes: 1024,
      filters: [{ id: 'all', label: 'All' }],
      classify: (name: string) => (name.startsWith('VO_') ? 'voice' : 'sfx'),
      badge: (name: string) => (name.startsWith('VO_') ? 'VO' : 'SFX'),
      validate: (contents: Buffer) =>
        contents.subarray(0, 4).toString('ascii') === 'OggS' ? undefined : 'Invalid OGG.'
    }
  ])
}

describe('asset store', () => {
  it('builds a catalogue from registered asset types', async () => {
    await writeFile(join(sourceDir, 'notes.txt'), 'ignored')
    const [sounds] = await store().catalog()
    expect(sounds).toMatchObject({ id: 'sounds', count: 2 })
    expect(sounds.items.map((item: { name: string }) => item.name)).toEqual(['SFX_Move.ogg', 'VO_WOW.ogg'])
  })

  it('reads the source asset for cache-free previews', async () => {
    const result = await store().read('sounds', 'VO_WOW.ogg')
    expect(result.contentType).toBe('audio/ogg')
    expect(result.contents).toEqual(ogg(2))
  })

  it('replaces the source and every configured mirror', async () => {
    const replacement = ogg(9)
    await store().replace('sounds', 'SFX_Move.ogg', replacement)
    expect(await readFile(join(sourceDir, 'SFX_Move.ogg'))).toEqual(replacement)
    expect(await readFile(join(mirrorDir, 'SFX_Move.ogg'))).toEqual(replacement)
  })

  it('rejects traversal, unknown types, unknown assets, and invalid data', async () => {
    const assets = store()
    await expect(assets.read('images', 'SFX_Move.ogg')).rejects.toMatchObject<AssetStoreError>({ status: 404 })
    await expect(assets.replace('sounds', '../SFX_Move.ogg', ogg(3))).rejects.toMatchObject<AssetStoreError>({
      status: 400
    })
    await expect(assets.replace('sounds', 'Unknown.ogg', ogg(3))).rejects.toMatchObject<AssetStoreError>({
      status: 404
    })
    await expect(assets.replace('sounds', 'SFX_Move.ogg', Buffer.from('bad'))).rejects.toMatchObject<AssetStoreError>({
      status: 415
    })
  })
})
