import { SetMetadata } from '@nestjs/common'

/** Metadata key the {@link JwtAuthGuard} reads to skip auth on a route. */
export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Marks a route (or controller) as unauthenticated, exempting it from the
 * globally-registered {@link JwtAuthGuard}. Used on health and the login/register
 * endpoints.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
