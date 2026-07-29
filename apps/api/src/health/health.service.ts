import { Injectable } from '@nestjs/common'
import { PROTOCOL_VERSION } from '@tetris/protocol'
import { AppConfigService } from '../config/config.service'

export interface HealthStatus {
  status: 'ok'
  /** ISO-8601 server time. */
  timestamp: string
  /** Process uptime in seconds. */
  uptime: number
  environment: string
  protocolVersion: number
}

/**
 * Computes the liveness payload. Kept as a service (not inline in the
 * controller) so the same status can later feed readiness probes, a WS ping or
 * a metrics endpoint without duplicating the shape.
 */
@Injectable()
export class HealthService {
  constructor(private readonly config: AppConfigService) {}

  check(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      environment: this.config.nodeEnv,
      protocolVersion: PROTOCOL_VERSION
    }
  }
}
