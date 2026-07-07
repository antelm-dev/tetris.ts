import { defineConfig } from 'vite'

// Renderer-only Vite config. The Electron main/preload processes are built
// separately with Rollup (see rollup.config.mjs).
export default defineConfig({
  root: 'renderer',
  base: '/',
  build: {
    outDir: '../dist-renderer',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
