import { createParamDecorator } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { AuthenticatedUser } from '../interfaces/auth.interface'

/**
 * Extracts the authenticated principal that {@link JwtAuthGuard} attached to the
 * request. Usage: `me(@CurrentUser() user: AuthenticatedUser)`. Returns
 * `undefined` on unauthenticated (public) routes.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>()
    return request.user
  }
)
