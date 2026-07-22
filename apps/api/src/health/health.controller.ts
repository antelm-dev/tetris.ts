import { Controller, Get } from '@nestjs/common'
import { Public } from '../auth/decorators/public.decorator'
import { HealthService } from './health.service'
import type { HealthStatus } from './health.service'

/** `GET /api/health` — unauthenticated liveness probe for the web and Electron clients and for infra. */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  check(): HealthStatus {
    return this.health.check()
  }
}
