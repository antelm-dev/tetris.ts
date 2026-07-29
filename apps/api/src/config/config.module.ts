import { Global, Module } from '@nestjs/common'
import { AppConfigService } from './config.service'
import { loadConfig } from './env.schema'

/**
 * Loads and validates configuration once, at module construction, and exposes
 * the typed {@link AppConfigService} app-wide. Marked `@Global` so every other
 * module can inject the config without re-importing this one.
 *
 * Validation happens in {@link loadConfig}: an invalid environment throws here,
 * during bootstrap, so the process never starts in a half-configured state.
 */
@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useFactory: () => new AppConfigService(loadConfig(process.env))
    }
  ],
  exports: [AppConfigService]
})
export class ConfigModule {}
