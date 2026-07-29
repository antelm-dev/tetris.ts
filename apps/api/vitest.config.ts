import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * Vitest (the repo's test runner) with SWC transforming the sources so NestJS
 * decorators and their emitted metadata work — the same transform the build
 * uses. Test env is provided by `test/setup-env.ts` before any module loads.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['test/setup-env.ts']
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true
      }
    })
  ]
})
