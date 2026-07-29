import { Module } from '@nestjs/common'
import { InMemoryUserRepository } from './in-memory-user.repository'
import { USER_REPOSITORY } from './interfaces/user-repository.interface'
import { UsersService } from './users.service'

/**
 * Owns the user domain and the persistence binding. Today {@link USER_REPOSITORY}
 * resolves to the dev-only {@link InMemoryUserRepository}; the production step is
 * to swap this single provider for a `PrismaUserRepository` (PostgreSQL) —
 * nothing else in the app references the concrete store.
 */
@Module({
  providers: [
    UsersService,
    {
      provide: USER_REPOSITORY,
      useClass: InMemoryUserRepository
    }
  ],
  exports: [UsersService]
})
export class UsersModule {}
