import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(import.meta.url))

/**
 * Runtime configuration. `production` is baked in at build time by the Rollup
 * `replace` plugin (`process.env.NODE_ENV`); paths are resolved relative to the
 * bundled `main.js` so they work both unpackaged and packaged.
 */
export const env = Object.freeze({
  production: process.env.NODE_ENV === 'production',
  scheme: 'app',
  window: {
    width: 1024,
    height: 768,
  },
  devServerUrl: 'http://localhost:5173',
  paths: {
    preload: join(rootDir, 'preload.cjs'),
    clientDir: join(rootDir, '../dist-renderer'),
    icon: join(rootDir, '../resources/icon.png')
  },
  urls: {
    renderer: 'app://bundle/index.html'
  }
})

export type Env = typeof env
