import { describe, it, expect } from 'vitest'
import { systemIpc } from '../../main/ipc/system.ipc'
import { createFakeIpc } from './fake-ipc'

describe('systemIpc', () => {
  it('registers prefixed handlers', async () => {
    const { ipc, handlers } = createFakeIpc()
    await systemIpc(ipc)
    expect([...handlers.keys()]).toEqual(['system:ping', 'system:get-version'])
  })

  it('ping resolves "pong"', async () => {
    const { ipc, handlers } = createFakeIpc()
    await systemIpc(ipc)
    expect(await handlers.get('system:ping')!({})).toBe('pong')
  })

  it('get-version returns the app version', async () => {
    const { ipc, handlers } = createFakeIpc()
    await systemIpc(ipc)
    expect(await handlers.get('system:get-version')!({})).toBe('9.9.9')
  })
})
