import type { PublicUser } from '../../users/interfaces/user.interface'

/**
 * The claims embedded in a signed JWT. `sub` is the user id (JWT convention);
 * `type` distinguishes an access token from a refresh token so a refresh token
 * can never be replayed as an access token and vice-versa.
 */
export interface JwtPayload {
  sub: string
  email: string
  type: 'access' | 'refresh'
}

/** An issued access/refresh pair. Access is short-lived; refresh mints new access tokens. */
export interface TokenPair {
  accessToken: string
  refreshToken: string
  /** Seconds until the access token expires — convenience for clients. */
  expiresIn: number
}

/** What the register/login/refresh flows return: the public user plus fresh tokens. */
export interface AuthResult {
  user: PublicUser
  tokens: TokenPair
}

/**
 * The authenticated principal attached to a request by the JWT guard and read
 * via the `@CurrentUser()` decorator. Kept minimal — the token's trusted claims.
 */
export interface AuthenticatedUser {
  id: string
  email: string
}
