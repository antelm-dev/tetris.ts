import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AppConfigService } from '../config/config.service'
import type { CreateUserInput, User } from './interfaces/user.interface'
import type { UserRepository } from './interfaces/user-repository.interface'

/**
 * DEV-ONLY user store. This exists so the auth flows are runnable end-to-end in
 * development and tests WITHOUT standing up a database — it is explicitly **not**
 * the production persistence layer. It holds users in a `Map`, so every restart
 * wipes them.
 *
 * It refuses to construct when `NODE_ENV=production`: the production build must
 * bind {@link USER_REPOSITORY} to a real `PrismaUserRepository` (PostgreSQL)
 * instead. See {@link UserRepository} for the contract to implement.
 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly logger = new Logger(InMemoryUserRepository.name)
  private readonly byId = new Map<string, User>()
  private readonly byEmail = new Map<string, User>()

  constructor(config: AppConfigService) {
    if (config.isProduction) {
      throw new Error(
        'InMemoryUserRepository is a development-only stand-in and must not run in production. ' +
          'Bind USER_REPOSITORY to a real PrismaUserRepository (PostgreSQL) before deploying.'
      )
    }
    this.logger.warn('Using in-memory user store — data is not persisted. For development only.')
  }

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null
  }

  async create(input: CreateUserInput): Promise<User> {
    const user: User = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      createdAt: new Date()
    }
    this.byId.set(user.id, user)
    this.byEmail.set(user.email, user)
    return user
  }
}
