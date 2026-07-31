import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { tap } from 'rxjs/operators'
import type { Observable } from 'rxjs'
import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * One line per HTTP request: `POST /api/auth/login 200 12ms`. Errors are left
 * to {@link AllExceptionsFilter}, which already logs the unexpected ones — this
 * only records that the request happened and how long it took.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP')

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // WebSocket traffic has its own logging in the gateway; skip it here.
    if (context.getType() !== 'http') return next.handle()

    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const reply = context.switchToHttp().getResponse<FastifyReply>()
    const startedAt = Date.now()

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(`${request.method} ${request.url} ${reply.statusCode} ${Date.now() - startedAt}ms`),
        error: (err: unknown) => {
          const status =
            typeof (err as { status?: number }).status === 'number' ? (err as { status: number }).status : 500
          this.logger.warn(`${request.method} ${request.url} ${status} ${Date.now() - startedAt}ms`)
        }
      })
    )
  }
}
