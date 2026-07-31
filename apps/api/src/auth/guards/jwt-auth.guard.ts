import { CanActivate, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { TokenService } from '../token.service'
import type { AuthenticatedUser } from '../interfaces/auth.interface'

/**
 * Verifies the `Authorization: Bearer <access token>` header and attaches the
 * resulting {@link AuthenticatedUser} to the request. Routes marked with
 * `@Public()` are skipped. Registered globally in `AuthModule`, so every route
 * is protected by default and opts out explicitly — the safe direction.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user?: AuthenticatedUser
    }>()

    const token = this.extractBearer(request.headers.authorization)
    if (!token) {
      this.logger.debug('Rejected request: missing or malformed bearer token')
      throw new UnauthorizedException('Missing bearer token')
    }

    const payload = await this.tokens.verifyAccess(token)
    if (!payload) {
      this.logger.debug('Rejected request: invalid or expired access token')
      throw new UnauthorizedException('Invalid or expired token')
    }

    request.user = { id: payload.sub, email: payload.email }
    return true
  }

  private extractBearer(header: string | undefined): string | null {
    if (!header) return null
    const [scheme, value] = header.split(' ')
    return scheme === 'Bearer' && value ? value : null
  }
}
