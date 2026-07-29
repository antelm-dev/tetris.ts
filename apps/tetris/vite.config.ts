import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

/**
 * Renderer-only Vite config, shared by both build targets. The Electron
 * main/preload processes are built separately with Rollup (see
 * rollup.config.mjs); the web target's tiny Express API server lives in
 * `server/`.
 *
 * Target is picked by `--mode`: `electron` (used by `dev`/`build:renderer`)
 * builds the frameless-titlebar shell against `dist-renderer`, everything
 * else (the default mode) builds the plain-browser shell against
 * `dist-web`. Each target loads its own `.env.<mode>` file automatically.
 * Production source maps are opt-in via TETRIS_SOURCEMAP=1.
 *
 * `root` is the HTML entry folder (`renderer/`), but `envDir` must stay at the
 * package root so `.env.web` / `.env.electron` (and `*.local` overrides) load.
 */
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'
  const env = loadEnv(mode, packageRoot, '')
  const sourcemap = env.TETRIS_SOURCEMAP === '1' || env.TETRIS_SOURCEMAP === 'true'
  const apiPort = Number(process.env.PORT ?? 4000)

  return {
    root: 'renderer',
    envDir: packageRoot,
    base: env.VITE_BASE || '/',
    // Static assets (sounds) live with the shared game UI in @tetris/renderer,
    // not in this app shell, so both the desktop and (future) web app serve the
    // same files from one source of truth.
    publicDir: fileURLToPath(new URL('../../packages/renderer/public', import.meta.url)),
    build: {
      outDir: isElectron ? '../dist-renderer' : '../dist-web',
      emptyOutDir: true,
      sourcemap,
      rollupOptions: isElectron
        ? { input: fileURLToPath(new URL('./renderer/index.electron.html', import.meta.url)) }
        : undefined
    },
    server: {
      port: isElectron ? 5173 : 5174,
      strictPort: true,
      // The web dev server proxies the API to the Express server (see
      // `server/index.mjs`, started alongside Vite by `pnpm dev:web`).
      // Electron talks to the main process over IPC instead.
      proxy: isElectron ? undefined : { '/api': `http://localhost:${apiPort}` }
    }
  }
})
