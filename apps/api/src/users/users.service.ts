import { Inject, Injectable } from '@nestjs/common'
import { USER_REPOSITORY } from './interfaces/user-repository.interface'
import type { UserRepository } from './interfaces/user-repository.interface'
import type { CreateUserInput, User } from './interfaces/user.interface'

/**
 * Thin domain service over the {@link UserRepository}. It owns "what a user is"
 * so other modules (auth) never talk to the raw repository token directly and
 * we have one place to add invariants (uniqueness, normalization) later.
 */
@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  findById(id: string): Promise<User | null> {
    return this.users.findById(id)
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email)
  }

  create(input: CreateUserInput): Promise<User> {
    return this.users.create(input)
  }
}
