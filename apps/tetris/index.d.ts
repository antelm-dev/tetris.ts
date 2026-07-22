export {}

declare global {
  interface Window {
    electron?: {
      bridge: typeof import('./main/generated/ipc-bridge.js').bridge
    }
  }
}
