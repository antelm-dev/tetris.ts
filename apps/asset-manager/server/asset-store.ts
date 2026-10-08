import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { modifiedPaths } from './git-status.ts'
import type { AssetItem, AssetTypeDefinition, AssetTypeSummary } from './types.ts'
import { referencedNames } from './usage.ts'

export class AssetStoreError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface AssetStore {
  catalog(): Promise<AssetTypeSummary[]>
  read(typeId: string, name: string): Promise<{ contents: Buffer; contentType: string }>
  replace(typeId: string, name: string, contents: unknown): Promise<AssetItem>
  add(typeId: string, name: string, contents: unknown): Promise<AssetItem>
  remove(typeId: string, name: string): Promise<void>
  uploadLimit(typeId: string): number
}

export function createAssetStore(registry: AssetTypeDefinition[]): AssetStore {
  const types = new Map(registry.map((type) => [type.id, type]))

  function requireType(typeId: string): AssetTypeDefinition {
    const type = types.get(typeId)
    if (!type) throw new AssetStoreError(404, 'That asset type is not registered.')
    return type
  }

  function isSafeName(type: AssetTypeDefinition, name: string): boolean {
    return (
      basename(name) === name && /^[A-Za-z0-9_.-]+$/.test(name) && type.extensions.includes(extname(name).toLowerCase())
    )
  }

  function destinationsFor(type: AssetTypeDefinition, name: string): string[] {
    return [type.sourceDir, ...type.mirrors].map((directory) => join(directory, name))
  }

  async function listNames(type: AssetTypeDefinition): Promise<string[]> {
    const entries = await readdir(type.sourceDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && isSafeName(type, entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  }

  /** Builds catalogue items, reading the usage source and git status once for the whole batch. */
  async function describe(type: AssetTypeDefinition, names: string[]): Promise<AssetItem[]> {
    const gitCwd = dirname(type.sourceDir)
    const [usageText, modified] = await Promise.all([
      type.usageSource ? readFile(type.usageSource, 'utf8').catch(() => undefined) : undefined,
      modifiedPaths(
        gitCwd,
        [type.sourceDir, ...type.mirrors].map((directory) => relative(gitCwd, directory) || '.')
      )
    ])
    const used = usageText === undefined ? undefined : referencedNames(usageText, type.extensions)

    return Promise.all(
      names.map(async (name) => {
        const info = await stat(join(type.sourceDir, name))
        const item: AssetItem = {
          name,
          bytes: info.size,
          updatedAt: info.mtime.toISOString(),
          filter: type.classify?.(name) ?? 'all',
          badge: type.badge?.(name) ?? extname(name).slice(1).toUpperCase(),
          modified: destinationsFor(type, name).some((path) => modified.has(path))
        }
        if (used) item.used = used.has(name)
        if (type.mirrors.length > 0) item.inSync = await mirrorsInSync(type, name, info.size)
        return item
      })
    )
  }

  /** Compares the source with each mirror: size first, then sha1 only when sizes match. */
  async function mirrorsInSync(type: AssetTypeDefinition, name: string, bytes: number): Promise<boolean> {
    const [source, ...mirrors] = destinationsFor(type, name)
    const infos = await Promise.all(mirrors.map((path) => stat(path).catch(() => undefined)))
    if (infos.some((info) => !info?.isFile() || info.size !== bytes)) return false
    const [sourceHash, ...mirrorHashes] = await Promise.all([source, ...mirrors].map(sha1))
    return mirrorHashes.every((hash) => hash === sourceHash)
  }

  async function catalog(): Promise<AssetTypeSummary[]> {
    return Promise.all(
      registry.map(async (type) => {
        const items = await describe(type, await listNames(type))
        return {
          id: type.id,
          label: type.label,
          singular: type.singular,
          description: type.description,
          accept: type.accept,
          preview: type.preview,
          maxBytes: type.maxBytes,
          filters: type.filters,
          count: items.length,
          items
        }
      })
    )
  }

  function requireSafeName(typeId: string, name: string): AssetTypeDefinition {
    const type = requireType(typeId)
    if (!isSafeName(type, name)) throw new AssetStoreError(400, 'Invalid asset filename.')
    return type
  }

  async function requireAsset(typeId: string, name: string): Promise<AssetTypeDefinition> {
    const type = requireSafeName(typeId, name)
    if (!(await listNames(type)).includes(name)) throw new AssetStoreError(404, 'That asset does not exist.')
    return type
  }

  function requireContents(type: AssetTypeDefinition, contents: unknown): Buffer {
    if (!Buffer.isBuffer(contents) || contents.length === 0) {
      throw new AssetStoreError(400, `Choose a non-empty ${type.singular} file.`)
    }
    if (contents.length > type.maxBytes) {
      throw new AssetStoreError(413, `${type.label} must be ${formatMegabytes(type.maxBytes)} MB or smaller.`)
    }
    const validationError = type.validate?.(contents)
    if (validationError) throw new AssetStoreError(415, validationError)
    return contents
  }

  /** Writes `contents` to every destination; on failure restores `originals` (or removes new files). */
  async function writeAll(destinations: string[], contents: Buffer, originals: (Buffer | undefined)[]): Promise<void> {
    const nonce = `${process.pid}-${Date.now()}`
    const temporary = destinations.map((path) => `${path}.${nonce}.tmp`)

    try {
      await Promise.all(destinations.map((path) => mkdir(dirname(path), { recursive: true })))
      await Promise.all(temporary.map((path) => writeFile(path, contents, { flag: 'wx' })))
      await Promise.all(temporary.map((path, index) => rename(path, destinations[index])))
    } catch (error) {
      await Promise.allSettled(temporary.map((path) => unlink(path)))
      await Promise.allSettled(
        destinations.map((path, index) => {
          const original = originals[index]
          return original ? writeFile(path, original) : unlink(path)
        })
      )
      throw error
    }
  }

  async function read(typeId: string, name: string): Promise<{ contents: Buffer; contentType: string }> {
    const type = await requireAsset(typeId, name)
    return { contents: await readFile(join(type.sourceDir, name)), contentType: type.contentType }
  }

  async function replace(typeId: string, name: string, contents: unknown): Promise<AssetItem> {
    const type = await requireAsset(typeId, name)
    const buffer = requireContents(type, contents)
    const destinations = destinationsFor(type, name)
    const originals = await Promise.all(destinations.map((path) => readFile(path)))
    await writeAll(destinations, buffer, originals)
    return (await describe(type, [name]))[0]
  }

  async function add(typeId: string, name: string, contents: unknown): Promise<AssetItem> {
    const type = requireSafeName(typeId, name)
    const exists = await stat(join(type.sourceDir, name)).then(
      () => true,
      () => false
    )
    if (exists) throw new AssetStoreError(409, `A ${type.singular} named ${name} already exists.`)
    const buffer = requireContents(type, contents)
    const destinations = destinationsFor(type, name)
    // A stale copy may already sit in a mirror; keep it so a failed add leaves it untouched.
    const originals = await Promise.all(destinations.map((path) => readFile(path).catch(() => undefined)))
    await writeAll(destinations, buffer, originals)
    return (await describe(type, [name]))[0]
  }

  async function remove(typeId: string, name: string): Promise<void> {
    const type = await requireAsset(typeId, name)
    const destinations = destinationsFor(type, name)
    const originals = await Promise.all(destinations.map((path) => readFile(path).catch(() => undefined)))
    try {
      await Promise.all(destinations.map((path, index) => (originals[index] ? unlink(path) : undefined)))
    } catch (error) {
      await Promise.allSettled(
        destinations.map((path, index) => {
          const original = originals[index]
          return original ? writeFile(path, original) : undefined
        })
      )
      throw error
    }
  }

  function uploadLimit(typeId: string): number {
    return requireType(typeId).maxBytes
  }

  return { catalog, read, replace, add, remove, uploadLimit }
}

async function sha1(path: string): Promise<string> {
  return createHash('sha1')
    .update(await readFile(path))
    .digest('hex')
}

function formatMegabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}
