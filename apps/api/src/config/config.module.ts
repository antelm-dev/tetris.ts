import { join } from 'node:path'
import { Global, Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule } from '@nestjs/config'
import { AppConfigService } from './config.service'
import { loadConfig } from './env.schema'

/**
 * Loads and validates configuration once, at module construction, and exposes
 * the typed {@link AppConfigService} app-wide. Marked `@Global` so every other
 * module can inject the config without re-importing this one.
 *
 * Nest's ConfigModule pulls `apps/api/.env` into `process.env` (if present);
 * {@link loadConfig} then validates with zod so the process never starts
 * half-configured.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Resolve from the package root so it works whether cwd is the monorepo
      // root or apps/api (pnpm -C / nest start).
      envFilePath: [join(__dirname, '..', '..', '.env'), '.env']
    })
  ],
  providers: [
    {
      provide: AppConfigService,
      useFactory: () => new AppConfigService(loadConfig(process.env))
    }
  ],
  exports: [AppConfigService]
})
export class ConfigModule {}
