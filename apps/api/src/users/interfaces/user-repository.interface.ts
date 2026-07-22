import type { CreateUserInput, User } from './user.interface'

/**
 * Injection token for the user store. Consumers depend on {@link UserRepository}
 * through this token, so swapping the dev in-memory store for a Prisma/Postgres
 * implementation is a one-line provider change and nothing else moves.
 */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY')

/**
 * Persistence contract for users — the seam where a real database plugs in.
 *
 * The intended production implementation is PostgreSQL via Prisma: create a
 * `PrismaUserRepository` that satisfies this interface and bind it to
 * {@link USER_REPOSITORY} in `UsersModule`. Until then the dev-only in-memory
 * store stands in (and refuses to run in production). No method here leaks a
 * framework or SQL detail, so the auth layer stays storage-agnostic.
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  create(input: CreateUserInput): Promise<User>
}
