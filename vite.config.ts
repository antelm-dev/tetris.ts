import { defineConfig } from 'vite'

// Renderer-only Vite config. The Electron main/preload processes are built
// separately with Rollup (see rollup.config.mjs).
// Production source maps are opt-in via TETRIS_SOURCEMAP=1.
const sourcemap = process.env.TETRIS_SOURCEMAP === '1' || process.env.TETRIS_SOURCEMAP === 'true'

export default defineConfig({
  root: 'renderer',
  base: '/',
  build: {
    outDir: '../dist-renderer',
    emptyOutDir: true,
    sourcemap
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
