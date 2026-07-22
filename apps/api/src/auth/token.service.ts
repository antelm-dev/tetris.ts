import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AppConfigService } from '../config/config.service'
import type { JwtPayload, TokenPair } from './interfaces/auth.interface'
import type { User } from '../users/interfaces/user.interface'

/**
 * Signs and verifies the access/refresh JWTs, keeping token concerns out of
 * {@link AuthService}. Access and refresh tokens are signed from the same
 * secret but carry a distinct `type` claim and different TTLs, so one can never
 * substitute for the other.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService
  ) {}

  async issueTokens(user: Pick<User, 'id' | 'email'>): Promise<TokenPair> {
    const base = { sub: user.id, email: user.email }
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...base, type: 'access' } satisfies JwtPayload, {
        expiresIn: this.config.jwt.accessTtl
      }),
      this.jwt.signAsync({ ...base, type: 'refresh' } satisfies JwtPayload, {
        expiresIn: this.config.jwt.refreshTtl
      })
    ])
    return { accessToken, refreshToken, expiresIn: this.ttlToSeconds(this.config.jwt.accessTtl) }
  }

  verifyAccess(token: string): Promise<JwtPayload | null> {
    return this.verify(token, 'access')
  }

  verifyRefresh(token: string): Promise<JwtPayload | null> {
    return this.verify(token, 'refresh')
  }

  private async verify(token: string, type: JwtPayload['type']): Promise<JwtPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token)
      return payload.type === type ? payload : null
    } catch {
      return null
    }
  }

  /** Best-effort conversion of a `15m`/`7d`/`3600` TTL string to seconds, for the `expiresIn` hint. */
  private ttlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])?$/.exec(ttl.trim())
    if (!match) return 0
    const value = Number(match[1])
    const unit = match[2] ?? 's'
    const factor = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 1
    return value * factor
  }
}
