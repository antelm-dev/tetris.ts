import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

/**
 * Password hashing, isolated behind a service so the algorithm and its
 * parameters live in exactly one place. Uses Argon2id — the memory-hard,
 * side-channel-resistant variant recommended for password storage.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = { type: argon2.argon2id }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options)
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain)
  }
}
