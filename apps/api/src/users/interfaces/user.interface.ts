/**
 * The persisted user shape. Deliberately framework- and storage-agnostic: the
 * concrete store (PostgreSQL via Prisma, see {@link UserRepository}) maps its
 * own rows onto this. The password hash never leaves the persistence layer in
 * responses — see {@link PublicUser}.
 */
export interface User {
  id: string
  email: string
  displayName: string
  /** Argon2id hash — never a plaintext password, never serialized to clients. */
  passwordHash: string
  createdAt: Date
}

/** The safe projection of a {@link User} returned to clients and embedded in tokens. */
export interface PublicUser {
  id: string
  email: string
  displayName: string
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName }
}

/** Fields needed to create a user; the hash is computed by the auth layer, not the caller. */
export interface CreateUserInput {
  email: string
  displayName: string
  passwordHash: string
}
