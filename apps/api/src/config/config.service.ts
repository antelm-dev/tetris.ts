import { Injectable } from '@nestjs/common'
import type { AppConfig } from './env.schema'

/**
 * Typed accessor for the validated {@link AppConfig}. Injected everywhere the
 * app needs configuration, so nothing else touches `process.env`. Backed by the
 * value produced at boot in {@link ConfigModule}.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: AppConfig) {}

  get nodeEnv(): AppConfig['nodeEnv'] {
    return this.config.nodeEnv
  }

  get isProduction(): boolean {
    return this.config.isProduction
  }

  get http(): AppConfig['http'] {
    return this.config.http
  }

  get jwt(): AppConfig['jwt'] {
    return this.config.jwt
  }

  get realtime(): AppConfig['realtime'] {
    return this.config.realtime
  }
}
