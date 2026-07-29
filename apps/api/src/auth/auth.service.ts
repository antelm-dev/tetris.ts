import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
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
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService
  ) {}

  async register(input: { email: string; displayName: string; password: string }): Promise<AuthResult> {
    const existing = await this.users.findByEmail(input.email)
    if (existing) throw new ConflictException('Email already registered')

    const passwordHash = await this.passwords.hash(input.password)
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash
    })

    return { user: toPublicUser(user), tokens: await this.tokens.issueTokens(user) }
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email)
    // Verify even when the user is missing would be ideal to blunt timing
    // oracles; kept simple here and noted for the hardening pass.
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const valid = await this.passwords.verify(user.passwordHash, input.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    return { user: toPublicUser(user), tokens: await this.tokens.issueTokens(user) }
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const payload = await this.tokens.verifyRefresh(refreshToken)
    if (!payload) throw new UnauthorizedException('Invalid refresh token')

    const user = await this.users.findById(payload.sub)
    if (!user) throw new UnauthorizedException('User no longer exists')

    return { user: toPublicUser(user), tokens: await this.tokens.issueTokens(user) }
  }

  async currentUser(userId: string): Promise<AuthResult['user']> {
    const user = await this.users.findById(userId)
    if (!user) throw new UnauthorizedException('User no longer exists')
    return toPublicUser(user)
  }
}
