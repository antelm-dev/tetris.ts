import 'reflect-metadata'
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { AppConfigService } from './config/config.service'

/**
 * Boot the modular monolith on Fastify. Everything global that the whole app
 * relies on — the `/api` prefix, strict DTO validation, consistent errors and
 * CORS — is set up here so no individual controller has to remember it.
 */
async function bootstrap(): Promise<void> {
  // Buffer until LoggerModule's configured logger is available, so boot logs
  // also honour LOG_LEVEL instead of using Nest's defaults.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true
  })
  app.useLogger(app.get(ConsoleLogger))

  const config = app.get(AppConfigService)
  const logger = new Logger('Bootstrap')

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

  // OpenAPI docs at /api/docs (JSON at /api/docs-json). Routes are described by
  // the @Api* decorators on the controllers and DTOs.
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Tetris API')
        .setDescription('REST surface of the Tetris modular monolith. Realtime play runs over the WebSocket namespace and is not covered here.')
        .setVersion('1.0')
        .addBearerAuth()
        .build()
    ),
    { swaggerOptions: { persistAuthorization: true } }
  )

  await app.listen({ host: config.http.host, port: config.http.port })
  logger.log(`API listening on http://${config.http.host}:${config.http.port}/api`)
  logger.log(`API docs on http://${config.http.host}:${config.http.port}/api/docs`)
  logger.log(`env=${config.nodeEnv} logLevel=${config.logLevel} wsNamespace=${config.realtime.namespace}`)
}

void bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').error('API failed to start', err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
