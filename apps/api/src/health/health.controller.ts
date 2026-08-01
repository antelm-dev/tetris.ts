import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { Public } from '../auth/decorators/public.decorator'
import { HealthService } from './health.service'
import type { HealthStatus } from './health.service'

/** Swagger mirror of {@link HealthStatus} — `implements` keeps the two in sync. */
class HealthStatusDto implements HealthStatus {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok'

  @ApiProperty({ format: 'date-time', description: 'ISO-8601 server time.' })
  timestamp!: string

  @ApiProperty({ description: 'Process uptime in seconds.' })
  uptime!: number

  @ApiProperty({ example: 'development' })
  environment!: string

  @ApiProperty()
  protocolVersion!: number
}

/** `GET /api/health` — unauthenticated liveness probe for the web and Electron clients and for infra. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthStatusDto })
  check(): HealthStatus {
    return this.health.check()
  }
}
