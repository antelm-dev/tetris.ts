import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.ts'
import { createAssetStore } from '../server/asset-store.ts'
import type { AssetItem, AssetTypeSummary } from '../server/types.ts'

let root: string
let sourceDir: string
let mirrorDir: string
let server: Server
let baseUrl: string

const ogg = (marker: number): Buffer => Buffer.from([0x4f, 0x67, 0x67, 0x53, marker])

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tetris-assets-app-'))
  sourceDir = join(root, 'source')
  mirrorDir = join(root, 'mirror')
  await Promise.all([mkdir(sourceDir), mkdir(mirrorDir)])
  await Promise.all([
    writeFile(join(sourceDir, 'SFX_Move.ogg'), ogg(1)),
    writeFile(join(mirrorDir, 'SFX_Move.ogg'), ogg(1))
  ])

  const store = createAssetStore([
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
      validate: (contents) => (contents.subarray(0, 4).toString('ascii') === 'OggS' ? undefined : 'Invalid OGG.')
    }
  ])
  server = await new Promise<Server>((resolve) => {
    const listening = createApp(store).listen(0, '127.0.0.1', () => resolve(listening))
  })
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.close()
  await once(server, 'close')
  await rm(root, { recursive: true, force: true })
})

const put = (path: string, body: Buffer): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'audio/ogg' },
    body: new Uint8Array(body)
  })

// fetch silently drops a custom Host header (forbidden header name), so use node:http here.
const spoofedHost = (method: string, path: string, body?: Buffer): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, {
      method,
      headers: { host: 'evil.example', 'content-type': 'audio/ogg' }
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end(body)
  })

describe('asset manager routes', () => {
  it('serves the catalogue', async () => {
    const response = await fetch(`${baseUrl}/api/assets`)
    expect(response.status).toBe(200)
    const { types } = (await response.json()) as { types: AssetTypeSummary[] }
    expect(types).toHaveLength(1)
    expect(types[0]).toMatchObject({ id: 'sounds', count: 1 })
    expect(types[0].items.map((item) => item.name)).toEqual(['SFX_Move.ogg'])
  })

  it('serves one asset with its content type', async () => {
    const response = await fetch(`${baseUrl}/api/assets/sounds/SFX_Move.ogg`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/ogg')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(ogg(1))
  })

  it('replaces the source and mirror', async () => {
    const response = await put('/api/assets/sounds/SFX_Move.ogg', ogg(9))
    expect(response.status).toBe(200)
    const { asset } = (await response.json()) as { asset: AssetItem }
    expect(asset).toMatchObject({ name: 'SFX_Move.ogg', bytes: 5 })
    expect(await readFile(join(sourceDir, 'SFX_Move.ogg'))).toEqual(ogg(9))
    expect(await readFile(join(mirrorDir, 'SFX_Move.ogg'))).toEqual(ogg(9))
  })

  it('rejects writes with a non-local Host header', async () => {
    expect(await spoofedHost('PUT', '/api/assets/sounds/SFX_Move.ogg', ogg(9))).toBe(403)
    expect(await readFile(join(sourceDir, 'SFX_Move.ogg'))).toEqual(ogg(1))
  })

  it('adds a new asset', async () => {
    const response = await fetch(`${baseUrl}/api/assets/sounds/SFX_New.ogg`, {
      method: 'POST',
      headers: { 'content-type': 'audio/ogg' },
      body: new Uint8Array(ogg(4))
    })
    expect(response.status).toBe(201)
    const { asset } = (await response.json()) as { asset: AssetItem }
    expect(asset).toMatchObject({ name: 'SFX_New.ogg', bytes: 5 })
    expect(await readFile(join(mirrorDir, 'SFX_New.ogg'))).toEqual(ogg(4))
    expect((await fetch(`${baseUrl}/api/assets/sounds/SFX_New.ogg`)).status).toBe(200)
  })

  it('rejects adding over an existing asset or from a non-local Host header', async () => {
    const duplicate = await fetch(`${baseUrl}/api/assets/sounds/SFX_Move.ogg`, {
      method: 'POST',
      headers: { 'content-type': 'audio/ogg' },
      body: new Uint8Array(ogg(4))
    })
    expect(duplicate.status).toBe(409)
    expect(await spoofedHost('POST', '/api/assets/sounds/SFX_New.ogg', ogg(4))).toBe(403)
    expect((await fetch(`${baseUrl}/api/assets/sounds/SFX_New.ogg`)).status).toBe(404)
  })

  it('deletes an asset', async () => {
    expect(await spoofedHost('DELETE', '/api/assets/sounds/SFX_Move.ogg')).toBe(403)
    const response = await fetch(`${baseUrl}/api/assets/sounds/SFX_Move.ogg`, { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect((await fetch(`${baseUrl}/api/assets/sounds/SFX_Move.ogg`)).status).toBe(404)
  })

  it('rejects bodies over the type size limit', async () => {
    const response = await put('/api/assets/sounds/SFX_Move.ogg', Buffer.concat([ogg(9), Buffer.alloc(2048)]))
    expect(response.status).toBe(413)
  })

  it('rejects invalid OGG data', async () => {
    const response = await put('/api/assets/sounds/SFX_Move.ogg', Buffer.from('not an ogg'))
    expect(response.status).toBe(415)
  })

  it('returns 404 for unknown assets', async () => {
    expect((await fetch(`${baseUrl}/api/assets/sounds/Unknown.ogg`)).status).toBe(404)
    expect((await put('/api/assets/sounds/Unknown.ogg', ogg(9))).status).toBe(404)
  })
})
