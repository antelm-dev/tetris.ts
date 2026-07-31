import { ConsoleLogger, Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AppConfigService } from '../../config/config.service'
import { HttpLoggingInterceptor } from './http-logging.interceptor'
import { levelsFor } from './log-levels'

/**
 * The app-wide logger. Nest's own {@link ConsoleLogger} does the formatting; all
 * this module adds is the two things it can't know by itself — the level
 * threshold from `LOG_LEVEL`, and per-request HTTP logging.
 *
 * Classes keep using `new Logger(Foo.name)` as before; `app.useLogger()` in
 * `main.ts` points those at the instance provided here, so the threshold applies
 * everywhere including bootstrap.
 */
@Global()
@Module({
  providers: [
    {
      provide: ConsoleLogger,
      useFactory: (config: AppConfigService) => new ConsoleLogger('App', { logLevels: levelsFor(config.logLevel) }),
      inject: [AppConfigService]
    },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor }
  ],
  exports: [ConsoleLogger]
})
export class LoggerModule {}
