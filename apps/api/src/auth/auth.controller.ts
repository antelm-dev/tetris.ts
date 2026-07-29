import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { CurrentUser } from './decorators/current-user.decorator'
import { Public } from './decorators/public.decorator'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'
import { RegisterDto } from './dto/register.dto'
import type { AuthenticatedUser } from './interfaces/auth.interface'

/** REST auth surface under `/api/auth`. Register/login/refresh are public; `me` requires a valid access token. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken)
  }

  /** The current user, resolved from the bearer token by the global JWT guard. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.currentUser(user.id)
  }
}
