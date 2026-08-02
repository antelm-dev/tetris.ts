import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@tetris/protocol'
import { AppModule } from '../src/app.module'
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter'

/**
 * End-to-end check of the health endpoint through the real Fastify pipeline:
 * global `/api` prefix, validation pipe and exception filter all in place. Uses
 * Fastify's `inject` so no port is bound.
 */
describe('Health (e2e)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('GET /api/health returns status, timestamp, uptime and environment', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    expect(typeof body.uptime).toBe('number')
    expect(body.environment).toBe('test')
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('unknown routes are handled by the exception filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.statusCode).toBe(404)
    expect(body.path).toBe('/api/does-not-exist')
  })
})
