import { ApiProperty } from '@nestjs/swagger'
import { IsString, MinLength } from 'class-validator'

export class RefreshDto {
  @ApiProperty({ description: 'The refresh token returned by register/login/refresh.' })
  @IsString()
  @MinLength(1)
  refreshToken!: string
}
