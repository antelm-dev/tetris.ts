import { join } from 'node:path'
import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import { AssetStoreError } from './asset-store.ts'
import type { AssetStore } from './asset-store.ts'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

const asyncHandler =
  (handler: AsyncHandler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error)
    }
  }

function param(req: Request, key: string): string {
  return String(req.params[key])
}

function requireLocal(req: Request): void {
  if (!['localhost', '127.0.0.1', '::1'].includes(req.hostname)) {
    throw new AssetStoreError(403, 'Assets can only be changed from the local manager.')
  }
}

export function createApp(store: AssetStore): Express {
  const staticDir = join(process.cwd(), 'dist')
  const app = express()

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
      const asset = await store.read(param(req, 'type'), param(req, 'name'))
      res.set({ 'cache-control': 'no-store', 'content-type': asset.contentType }).send(asset.contents)
    })
  )

  // Generous transport cap; each type's maxBytes is the real gate.
  const rawBody = express.raw({ type: () => true, limit: '64mb' })

  app.put(
    '/api/assets/:type/:name',
    rawBody,
    asyncHandler(async (req, res) => {
      requireLocal(req)
      const asset = await store.replace(param(req, 'type'), param(req, 'name'), req.body)
      res.set('cache-control', 'no-store').json({ asset })
    })
  )

  app.post(
    '/api/assets/:type/:name',
    rawBody,
    asyncHandler(async (req, res) => {
      requireLocal(req)
      const asset = await store.add(param(req, 'type'), param(req, 'name'), req.body)
      res.status(201).set('cache-control', 'no-store').json({ asset })
    })
  )

  app.delete(
    '/api/assets/:type/:name',
    asyncHandler(async (req, res) => {
      requireLocal(req)
      await store.remove(param(req, 'type'), param(req, 'name'))
      res.status(204).end()
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

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent || !req.path.startsWith('/api/assets')) {
      next(error)
      return
    }
    if (error instanceof AssetStoreError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    if ((error as { type?: unknown } | null)?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That asset is too large.' })
      return
    }
    console.error(error)
    res.status(500).json({ error: 'The asset could not be updated.' })
  })

  return app
}
