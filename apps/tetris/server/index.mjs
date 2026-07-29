import { join } from 'node:path'
import express from 'express'
import { createHighScoreStore } from '@tetris/records'

/**
 * The web target's server. It does two jobs:
 *
 *  1. `/api/records` — the browser-facing twin of `main/ipc/game.ipc.ts`'s
 *     Electron IPC channels, backed by the same kind of JSON file.
 *  2. everything else — serves the static `dist-web` build in production.
 *
 * In development only job 1 matters: Vite's dev server (`pnpm dev:web`)
 * proxies `/api` here and serves the app itself, so `dist-web` doesn't need
 * to exist yet.
 */

const appDir = process.cwd()
const dataDir = join(appDir, 'server', 'data')
const staticDir = join(appDir, 'dist-web')

const store = createHighScoreStore(join(dataDir, 'high-score.json'))

/** Express doesn't handle a rejected async handler's promise itself — forward it to `next`. */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch((error) => next(error))

const app = express()
app.disable('x-powered-by') // don't advertise the framework/version
app.use(express.json())

// Container/platform liveness probe. Keep it independent from persisted data
// so a storage failure can be reported by the records endpoint itself.
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' })
})

app.get(
  '/api/records',
  asyncHandler(async (_req, res) => {
    res.json({ records: await store.read() })
  })
)

app.post(
  '/api/records',
  asyncHandler(async (req, res) => {
    res.json(await store.submit(req.body))
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

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => {
  console.log(`tetris.ts (web) listening on http://localhost:${port}`)
})
