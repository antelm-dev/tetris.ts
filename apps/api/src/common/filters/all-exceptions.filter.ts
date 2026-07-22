import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { ExceptionFilter } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

interface ErrorBody {
  statusCode: number
  error: string
  message: string | string[]
  path: string
  timestamp: string
}

/**
 * One consistent error shape for every failure, so the web and Electron clients
 * can parse errors uniformly. Nest's `HttpException`s keep their status and
 * message (including the array of messages from the validation pipe); anything
 * else becomes a 500 with its detail logged but not leaked.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()
    const request = ctx.getRequest<FastifyRequest>()

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

    let message: string | string[] = 'Internal server error'
    let error = 'InternalServerError'

    if (exception instanceof HttpException) {
      const response = exception.getResponse()
      error = exception.name
      message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message)
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack)
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString()
    }

    void reply.status(status).send(body)
  }
}
