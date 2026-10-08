import { execFileSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validatePng } from '../server/asset-registry.ts'
import { createAssetStore } from '../server/asset-store.ts'
import type { AssetTypeDefinition } from '../server/types.ts'

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

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

function store(overrides: Partial<AssetTypeDefinition> = {}) {
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
      classify: (name) => (name.startsWith('VO_') ? 'voice' : 'sfx'),
      badge: (name) => (name.startsWith('VO_') ? 'VO' : 'SFX'),
      validate: (contents) => (contents.subarray(0, 4).toString('ascii') === 'OggS' ? undefined : 'Invalid OGG.'),
      ...overrides
    }
  ])
}

describe('asset store', () => {
  it('builds a catalogue from registered asset types', async () => {
    await writeFile(join(sourceDir, 'notes.txt'), 'ignored')
    const [sounds] = await store().catalog()
    expect(sounds).toMatchObject({ id: 'sounds', count: 2 })
    expect(sounds.items.map((item) => item.name)).toEqual(['SFX_Move.ogg', 'VO_WOW.ogg'])
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
    await expect(assets.read('images', 'SFX_Move.ogg')).rejects.toMatchObject({ status: 404 })
    await expect(assets.replace('sounds', '../SFX_Move.ogg', ogg(3))).rejects.toMatchObject({
      status: 400
    })
    await expect(assets.replace('sounds', 'Unknown.ogg', ogg(3))).rejects.toMatchObject({
      status: 404
    })
    await expect(assets.replace('sounds', 'SFX_Move.ogg', Buffer.from('bad'))).rejects.toMatchObject({
      status: 415
    })
  })

  it('flags assets the usage source does not cite', async () => {
    const usageSource = join(root, 'manifest.ts')
    await writeFile(usageSource, "export const SFX = { move: 'SFX_Move.ogg' }")
    const [sounds] = await store({ usageSource }).catalog()
    expect(sounds.items.map((item) => [item.name, item.used])).toEqual([
      ['SFX_Move.ogg', true],
      ['VO_WOW.ogg', false]
    ])
  })

  it('omits usage when the usage source is missing or not configured', async () => {
    const [missing] = await store({ usageSource: join(root, 'missing.ts') }).catalog()
    const [unset] = await store().catalog()
    expect(missing.items.every((item) => item.used === undefined)).toBe(true)
    expect(unset.items.every((item) => item.used === undefined)).toBe(true)
  })

  it.skipIf(!gitAvailable)('reports assets with uncommitted git changes as modified', async () => {
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
        cwd: root,
        stdio: 'ignore'
      })
    }
    git('init', '-q')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'init')
    await writeFile(join(mirrorDir, 'VO_WOW.ogg'), ogg(7))

    const assets = store()
    const [sounds] = await assets.catalog()
    expect(sounds.items.map((item) => [item.name, item.modified])).toEqual([
      ['SFX_Move.ogg', false],
      ['VO_WOW.ogg', true]
    ])
    expect(await assets.replace('sounds', 'SFX_Move.ogg', ogg(8))).toMatchObject({ modified: true })
  })

  it('reports mirrors that drift from the source until the asset is replaced', async () => {
    const assets = store()
    await writeFile(join(mirrorDir, 'VO_WOW.ogg'), ogg(7))
    const [sounds] = await assets.catalog()
    expect(sounds.items.map((item) => [item.name, item.inSync])).toEqual([
      ['SFX_Move.ogg', true],
      ['VO_WOW.ogg', false]
    ])
    expect(await assets.replace('sounds', 'VO_WOW.ogg', ogg(3))).toMatchObject({ inSync: true })

    await rm(join(mirrorDir, 'SFX_Move.ogg'))
    const [afterRemoval] = await assets.catalog()
    expect(afterRemoval.items.map((item) => item.inSync)).toEqual([false, true])
  })

  it('adds a new asset to the source and every mirror', async () => {
    const item = await store().add('sounds', 'SFX_New.ogg', ogg(5))
    expect(item).toMatchObject({ name: 'SFX_New.ogg', bytes: 5, filter: 'sfx' })
    expect(await readFile(join(sourceDir, 'SFX_New.ogg'))).toEqual(ogg(5))
    expect(await readFile(join(mirrorDir, 'SFX_New.ogg'))).toEqual(ogg(5))
  })

  it('rejects adding duplicates and invalid data', async () => {
    const assets = store()
    await expect(assets.add('sounds', 'SFX_Move.ogg', ogg(5))).rejects.toMatchObject({ status: 409 })
    await expect(assets.add('sounds', 'SFX_Bad.ogg', Buffer.from('bad'))).rejects.toMatchObject({ status: 415 })
    expect(await exists(join(sourceDir, 'SFX_Bad.ogg'))).toBe(false)
    expect(await readFile(join(sourceDir, 'SFX_Move.ogg'))).toEqual(ogg(1))
  })

  it('removes an asset from the source and every mirror', async () => {
    const assets = store()
    await assets.remove('sounds', 'VO_WOW.ogg')
    expect(await exists(join(sourceDir, 'VO_WOW.ogg'))).toBe(false)
    expect(await exists(join(mirrorDir, 'VO_WOW.ogg'))).toBe(false)
    await expect(assets.remove('sounds', 'VO_WOW.ogg')).rejects.toMatchObject({ status: 404 })
  })

  it('lists nothing for a directory holding only .gitkeep', async () => {
    await rm(sourceDir, { recursive: true })
    await mkdir(sourceDir)
    await writeFile(join(sourceDir, '.gitkeep'), '')
    const [sounds] = await store().catalog()
    expect(sounds).toMatchObject({ count: 0, items: [] })
  })

  it('validates PNG magic bytes and lists only files, not subdirectories', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
    await writeFile(join(root, 'icon.png'), png)
    await mkdir(join(root, 'nested.png'))
    const images = createAssetStore([
      {
        id: 'images',
        label: 'Images',
        singular: 'image',
        description: 'Test images',
        sourceDir: root,
        mirrors: [],
        extensions: ['.png'],
        accept: '.png',
        contentType: 'image/png',
        preview: 'image',
        maxBytes: 1024,
        filters: [{ id: 'all', label: 'All' }],
        validate: validatePng
      }
    ])
    const [type] = await images.catalog()
    expect(type.items.map((item) => item.name)).toEqual(['icon.png'])
    expect(type.items[0].inSync).toBeUndefined()
    await expect(images.replace('images', 'icon.png', Buffer.from('not a png'))).rejects.toMatchObject({
      status: 415
    })
    await expect(images.replace('images', 'icon.png', png)).resolves.toMatchObject({ name: 'icon.png', bytes: 9 })
  })
})
