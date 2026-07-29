import { defineConfig } from 'tsup'

/**
 * Dual ESM + CJS build so the same contract is consumable by both sides of the
 * app: the client bundles ESM (Vite/Rollup), the NestJS API is emitted as CJS
 * and requires the `.cjs` output. `dts` ships the shared types.
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
