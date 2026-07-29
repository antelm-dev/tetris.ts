import { describe, expect, it } from 'vitest'
import { AppConfigService } from '../config/config.service'
import { loadConfig } from '../config/env.schema'
import { HealthService } from './health.service'

function makeService(): HealthService {
  const config = new AppConfigService(loadConfig({ JWT_SECRET: 'test-secret-at-least-16-chars', NODE_ENV: 'test' }))
  return new HealthService(config)
}

describe('HealthService', () => {
  it('reports an ok status with a valid ISO timestamp and the current environment', () => {
    const status = makeService().check()
    expect(status.status).toBe('ok')
    expect(status.environment).toBe('test')
    expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false)
    expect(status.uptime).toBeGreaterThanOrEqual(0)
    expect(status.protocolVersion).toBe(1)
  })
})
