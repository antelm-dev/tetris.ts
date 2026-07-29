import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { AppConfigService } from './config/config.service'

/**
 * Boot the modular monolith on Fastify. Everything global that the whole app
 * relies on — the `/api` prefix, strict DTO validation, consistent errors and
 * CORS — is set up here so no individual controller has to remember it.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: false
  })

  const config = app.get(AppConfigService)

  // All REST routes live under /api. WebSocket namespaces are separate.
  app.setGlobalPrefix('api')

  // Strict, transforming validation for every DTO: coerce types, strip unknown
  // props, and reject any request that carries properties we didn't declare.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true }
    })
  )

  app.useGlobalFilters(new AllExceptionsFilter())

  // CORS origins come from validated config (a list, `true` for any, or off).
  app.enableCors({
    origin: config.http.corsOrigins,
    credentials: true
  })

  await app.listen({ host: config.http.host, port: config.http.port })
  Logger.log(`API listening on http://${config.http.host}:${config.http.port}/api`, 'Bootstrap')
}

void bootstrap()
