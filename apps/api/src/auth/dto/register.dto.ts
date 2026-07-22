import { IsEmail, IsString, Length, MinLength } from 'class-validator'

/**
 * Registration input. These decorated DTOs are the server's REST contract and
 * are validated by the global strict `ValidationPipe` (whitelist + reject
 * unknown props + transform). They stay on the server: the client shares plain
 * types via `@tetris/protocol` instead, so no NestJS/class-validator coupling
 * crosses the wire.
 */
export class RegisterDto {
  @IsEmail()
  email!: string

  @IsString()
  @Length(2, 32)
  displayName!: string

  @IsString()
  @MinLength(8)
  password!: string
}
