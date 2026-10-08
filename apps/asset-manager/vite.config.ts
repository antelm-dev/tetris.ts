import { defineConfig } from 'vite'

const apiPort = Number(process.env.ASSET_MANAGER_PORT ?? 4010)

export default defineConfig({
  server: {
    port: 5175,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
