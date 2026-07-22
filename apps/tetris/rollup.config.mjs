import { createRequire } from 'node:module'
import { defineConfig } from 'rollup'
import { config as loadEnv } from 'dotenv'
import electronRun from 'electron-run/rollup-plugin'
import ipcBridge from 'electron-ipc-module/rollup-plugin'
import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import typescript from '@rollup/plugin-typescript'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const ENVIRONMENT = loadEnv({ path: IS_PRODUCTION ? '.env' : '.env.dev' }).parsed ?? {}

const replaceValues = {
  preventAssignment: true,
  'process.env.NODE_ENV': JSON.stringify(IS_PRODUCTION ? 'production' : 'development'),
  ...Object.fromEntries(
    Object.entries(ENVIRONMENT).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])
  )
}

export default defineConfig([
  {
    input: './main/preload.ts',
    cache: false,
    output: {
      file: './dist-main/preload.cjs',
      format: 'cjs',
      sourcemap: !IS_PRODUCTION
    },
    external: ['electron'],
    plugins: [
      // Regenerate the typed preload bridge from main/ipc/*.ipc.ts before compiling.
      ipcBridge({
        ipcDir: './main/ipc',
        outFile: './main/generated/ipc-bridge.ts',
        tsconfig: './tsconfig.main.json'
      }),
      json(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.preload.json',
        compilerOptions: { sourceMap: !IS_PRODUCTION }
      }),
      IS_PRODUCTION && terser()
    ]
  },
  {
    input: './main/main.ts',
    cache: false,
    watch: {
      clearScreen: false
    },
    output: {
      // CJS: Electron's `electron` module is CommonJS, so an ESM main bundle
      // cannot use named imports from it. Rollup shims `import.meta.url` here.
      file: './dist-main/main.cjs',
      format: 'cjs',
      sourcemap: !IS_PRODUCTION
    },
    external: ['electron', /^node:/],
    plugins: [
      json(),
      nodeResolve({ exportConditions: ['node'] }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.main.json',
        compilerOptions: { sourceMap: !IS_PRODUCTION }
      }),
      replace(replaceValues),
      IS_PRODUCTION && terser(),
      // Relaunch Electron on every rebuild in watch mode. `electronPath` is
      // passed explicitly because `electron` isn't resolvable from the linked
      // electron-run package. Resolved lazily so a plain `build` (and CI) never
      // needs the Electron binary.
      process.env.ROLLUP_WATCH &&
        electronRun({
          entry: 'main.cjs',
          electronPath: createRequire(import.meta.url)('electron'),
          additionalArgs: ['--inspect'],
          stdinControls: false
        })
    ]
  }
])
