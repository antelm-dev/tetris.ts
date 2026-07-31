import { Logger } from '@nestjs/common'
import type { LogLevel } from '@nestjs/common'
import { levelsFor } from '../src/common/logger/log-levels'

/**
 * Test-only environment. Set before any module (and thus the config validator)
 * loads, so specs and the e2e boot get a valid, deterministic config without a
 * real `.env`. The JWT secret here is a throwaway for tests only.
 */
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars-long'
process.env.API_HOST ??= '127.0.0.1'
process.env.API_PORT ??= '0'
process.env.CORS_ORIGINS ??= '*'
process.env.LOG_LEVEL ??= 'error'

// Keep test output readable. Specs instantiate services directly, bypassing
// LoggerModule, so apply the threshold to the default logger as well.
// See more with `LOG_LEVEL=debug pnpm test`.
Logger.overrideLogger(levelsFor(process.env.LOG_LEVEL as LogLevel))
