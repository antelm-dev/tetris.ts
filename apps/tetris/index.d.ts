export {}

interface ImportMetaEnv {
  readonly VITE_BASE?: string
  readonly VITE_API_ORIGIN?: string
  readonly VITE_ONLINE_MULTIPLAYER_UI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    electron?: {
      bridge: typeof import('./main/generated/ipc-bridge.js').bridge
    }
  }
}
