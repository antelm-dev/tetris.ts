import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { toPublicUser } from '../users/interfaces/user.interface'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'
import type { AuthResult } from './interfaces/auth.interface'

/**
 * Orchestrates the auth flows — register, login, refresh, and resolving the
 * current user — over the storage-agnostic {@link UsersService}, Argon2
 * hashing ({@link PasswordService}) and JWTs ({@link TokenService}).
 *
 * The logic here is real and final; only the *storage* behind `UsersService`
 * is currently the dev in-memory stand-in (see `UserRepository`). Swapping in
 * a Prisma/Postgres repository makes these flows production-ready with no
 * change to this service.
 */
@Injectable()
export class AuthService {
  // Auth logs identify users by id, never by password, token or full email.
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService
  ) {}

  async register(input: { email: string; displayName: string; password: string }): Promise<AuthResult> {
    const existing = await this.users.findByEmail(input.email)
    if (existing) {
      this.logger.warn(`Registration rejected: email already registered (${maskEmail(input.email)})`)
      throw new ConflictException('Email already registered')
    }

    const passwordHash = await this.passwords.hash(input.password)
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash
    })

    this.logger.log(`Registered user ${user.id}`)
    return { user: toPublicUser(user), tokens: await this.tokens.issueTokens(user) }
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email)
    // Verify even when the user is missing would be ideal to blunt timing
    // oracles; kept simple here and noted for the hardening pass.
    if (!user) {
      this.logger.warn(`Login failed: unknown email (${maskEmail(input.email)})`)
      throw new UnauthorizedException('Invalid credentials')
    }

    const valid = await this.passwords.verify(user.passwordHash, input.password)
    if (!valid) {
      this.logger.warn(`Login failed: bad password for user ${user.id}`)
      throw new UnauthorizedException('Invalid credentials')
    }

    this.logger.log(`Login succeeded for user ${user.id}`)
    return { user: toPublicUser(user), tokens: await this.tokens.issueTokens(user) }
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const payload = await this.tokens.verifyRefresh(refreshToken)
    if (!payload) {
      this.logger.warn('Refresh failed: invalid or expired refresh token')
      throw new UnauthorizedException('Invalid refresh token')
    }

    const user = await this.users.findById(payload.sub)
    if (!user) {
      this.logger.warn(`Refresh failed: user ${payload.sub} no longer exists`)
      throw new UnauthorizedException('User no longer exists')
    }

    this.logger.debug(`Refreshed tokens for user ${user.id}`)
    return { user: toPublicUser(user), tokens: await this.tokens.issueTokens(user) }
  }

  async currentUser(userId: string): Promise<AuthResult['user']> {
    const user = await this.users.findById(userId)
    if (!user) {
      this.logger.warn(`Token accepted for user ${userId}, but the user no longer exists`)
      throw new UnauthorizedException('User no longer exists')
    }
    return toPublicUser(user)
  }
}

/** `ada@example.com` -> `a**@example.com`. Enough to correlate, not enough to leak an address. */
function maskEmail(email: string): string {
  const [local = '', domain] = email.split('@')
  return domain ? `${local.slice(0, 1)}**@${domain}` : '***'
}
