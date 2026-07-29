import { defineConfig } from 'tsup'

/**
 * Nest emits CommonJS, while the renderer bundles ESM. Ship both forms for
 * the package root so the API never imports TypeScript source from `dist/`.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' })
})
