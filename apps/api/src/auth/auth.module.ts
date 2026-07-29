import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { AppConfigService } from '../config/config.service'
import { UsersModule } from '../users/users.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'

/**
 * Wires the auth foundations: Argon2 hashing, JWT signing/verification and the
 * globally-applied {@link JwtAuthGuard} (every route is protected unless marked
 * `@Public()`). The JWT secret comes from the validated config, never a literal.
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwt.secret
      })
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService, TokenService]
})
export class AuthModule {}
