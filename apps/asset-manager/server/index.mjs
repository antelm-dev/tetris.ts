import { join } from 'node:path'
import express from 'express'
import { assetRegistry } from './asset-registry.mjs'
import { AssetStoreError, createAssetStore } from './asset-store.mjs'

const appDir = process.cwd()
const staticDir = join(appDir, 'dist')
const store = createAssetStore(assetRegistry)
const app = express()

const asyncHandler = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next)
  } catch (error) {
    next(error)
  }
}

app.disable('x-powered-by')

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' })
})

app.get(
  '/api/assets',
  asyncHandler(async (_req, res) => {
    res.set('cache-control', 'no-store').json({ types: await store.catalog() })
  })
)

app.get(
  '/api/assets/:type/:name',
  asyncHandler(async (req, res) => {
    const asset = await store.read(req.params.type, req.params.name)
    res.set({ 'cache-control': 'no-store', 'content-type': asset.contentType }).send(asset.contents)
  })
)

app.put(
  '/api/assets/:type/:name',
  express.raw({ type: () => true, limit: '16mb' }),
  asyncHandler(async (req, res) => {
    if (!['localhost', '127.0.0.1', '::1'].includes(req.hostname)) {
      throw new AssetStoreError(403, 'Assets can only be replaced from the local manager.')
    }
    const asset = await store.replace(req.params.type, req.params.name, req.body)
    res.set('cache-control', 'no-store').json({ asset })
  })
)

app.use(express.static(staticDir, { index: false }))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) {
    next()
    return
  }
  res.sendFile(join(staticDir, 'index.html'), (error) => {
    if (error) next(error)
  })
})

app.use((error, req, res, next) => {
  if (res.headersSent || !req.path.startsWith('/api/assets')) {
    next(error)
    return
  }
  if (error instanceof AssetStoreError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'That asset is too large.' })
    return
  }
  console.error(error)
  res.status(500).json({ error: 'The asset could not be updated.' })
})

const port = Number(process.env.ASSET_MANAGER_PORT ?? 4010)
app.listen(port, () => {
  console.log(`tetris.ts asset manager API listening on http://localhost:${port}`)
})
