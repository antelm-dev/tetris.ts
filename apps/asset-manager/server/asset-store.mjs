import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

export class AssetStoreError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createAssetStore(registry) {
  const types = new Map(registry.map((type) => [type.id, type]))

  function requireType(typeId) {
    const type = types.get(typeId)
    if (!type) throw new AssetStoreError(404, 'That asset type is not registered.')
    return type
  }

  function isSafeName(type, name) {
    return (
      basename(name) === name && /^[A-Za-z0-9_.-]+$/.test(name) && type.extensions.includes(extname(name).toLowerCase())
    )
  }

  async function listItems(type) {
    const entries = await readdir(type.sourceDir, { withFileTypes: true })
    const names = entries
      .filter((entry) => entry.isFile() && isSafeName(type, entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    return Promise.all(
      names.map(async (name) => {
        const info = await stat(join(type.sourceDir, name))
        return {
          name,
          bytes: info.size,
          updatedAt: info.mtime.toISOString(),
          filter: type.classify?.(name) ?? 'all',
          badge: type.badge?.(name) ?? extname(name).slice(1).toUpperCase()
        }
      })
    )
  }

  async function catalog() {
    return Promise.all(
      registry.map(async (type) => {
        const items = await listItems(type)
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

  async function requireAsset(typeId, name) {
    const type = requireType(typeId)
    if (!isSafeName(type, name)) throw new AssetStoreError(400, 'Invalid asset filename.')
    const allowed = new Set((await listItems(type)).map((asset) => asset.name))
    if (!allowed.has(name)) throw new AssetStoreError(404, 'That asset does not exist.')
    return type
  }

  async function read(typeId, name) {
    const type = await requireAsset(typeId, name)
    return { contents: await readFile(join(type.sourceDir, name)), contentType: type.contentType }
  }

  async function replace(typeId, name, contents) {
    const type = await requireAsset(typeId, name)
    if (!Buffer.isBuffer(contents) || contents.length === 0) {
      throw new AssetStoreError(400, `Choose a non-empty ${type.singular} file.`)
    }
    if (contents.length > type.maxBytes) {
      throw new AssetStoreError(413, `${type.label} must be ${formatMegabytes(type.maxBytes)} MB or smaller.`)
    }
    const validationError = type.validate?.(contents)
    if (validationError) throw new AssetStoreError(415, validationError)

    const destinations = [type.sourceDir, ...type.mirrors].map((directory) => join(directory, name))
    const originals = await Promise.all(destinations.map((path) => readFile(path)))
    const nonce = `${process.pid}-${Date.now()}`
    const temporary = destinations.map((path) => `${path}.${nonce}.tmp`)

    try {
      await Promise.all(destinations.map((path) => mkdir(dirname(path), { recursive: true })))
      await Promise.all(temporary.map((path) => writeFile(path, contents, { flag: 'wx' })))
      await Promise.all(temporary.map((path, index) => rename(path, destinations[index])))
    } catch (error) {
      await Promise.allSettled(temporary.map((path) => unlink(path)))
      await Promise.allSettled(destinations.map((path, index) => writeFile(path, originals[index])))
      throw error
    }

    const info = await stat(join(type.sourceDir, name))
    return {
      name,
      bytes: info.size,
      updatedAt: info.mtime.toISOString(),
      filter: type.classify?.(name) ?? 'all',
      badge: type.badge?.(name) ?? extname(name).slice(1).toUpperCase()
    }
  }

  function uploadLimit(typeId) {
    return requireType(typeId).maxBytes
  }

  return { catalog, read, replace, uploadLimit }
}

function formatMegabytes(bytes) {
  return Math.round(bytes / 1024 / 1024)
}
