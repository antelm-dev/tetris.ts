import { protocol } from 'electron'

/**
 * Create a custom privileged scheme (e.g. `app://`) with helpers to register
 * and unregister its request handler. Mirrors the desktop app's core helper.
 */
export function createCustomScheme(name = 'app', privileges: Electron.Privileges = {}) {
  return {
    scheme: { scheme: name, privileges } as Electron.CustomScheme,
    unregisterHandler: () => protocol.unhandle(name),
    registerHandler: (handler: Parameters<typeof protocol.handle>[1]) =>
      protocol.handle(name, handler)
  }
}
