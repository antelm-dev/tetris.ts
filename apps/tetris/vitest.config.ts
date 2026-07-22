import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Standalone from vite.config.ts (which is renderer-only). Tests run in Node:
// the game engine is pure, and the IPC modules use a shared `electron` mock.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    clearMocks: true,
    // Route every `electron` import (including the ones inside the linked
    // electron-ipc-module) to a single controllable stub.
    alias: {
      electron: fileURLToPath(new URL('./test/mocks/electron.ts', import.meta.url))
    },
    server: {
      deps: {
        // Inline linked/workspace packages so (a) their TS source is transformed
        // and (b) module mocks (the `electron` alias, `vi.mock('node:fs/promises')`)
        // apply to their imports too.
        inline: ['electron-ipc-module', /@tetris\//]
      }
    }
  }
})
