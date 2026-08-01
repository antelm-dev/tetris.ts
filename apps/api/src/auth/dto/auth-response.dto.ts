import { ApiProperty } from '@nestjs/swagger'
import type { AuthResult, TokenPair } from '../interfaces/auth.interface'
import type { PublicUser } from '../../users/interfaces/user.interface'

/**
 * Swagger-only mirrors of the auth response interfaces. They `implements` the
 * real types, so TypeScript fails the build if a response shape changes here
 * or there — the docs can't silently drift from the contract.
 */
export class PublicUserDto implements PublicUser {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ format: 'email' })
  email!: string

  @ApiProperty()
  displayName!: string
}

export class TokenPairDto implements TokenPair {
  @ApiProperty()
  accessToken!: string

  @ApiProperty()
  refreshToken!: string

  @ApiProperty({ description: 'Seconds until the access token expires.' })
  expiresIn!: number
}

export class AuthResultDto implements AuthResult {
  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto

  @ApiProperty({ type: TokenPairDto })
  tokens!: TokenPairDto
}
