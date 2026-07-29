// Generate the typed preload bridge from `main/ipc/*.ipc.ts` without a full
// Rollup run. The Rollup build regenerates it too (see rollup.config.mjs); this
// script exists so `typecheck` has the file before the bundlers run.
import ipcBridge from 'electron-ipc-module/rollup-plugin'

const plugin = ipcBridge({
  ipcDir: './main/ipc',
  outFile: './main/generated/ipc-bridge.ts',
  tsconfig: './tsconfig.main.json'
})

// Standalone invocation — provide the Rollup plugin-context methods `buildStart`
// expects when running outside a bundler.
plugin.buildStart.call({
  addWatchFile() {}
})
