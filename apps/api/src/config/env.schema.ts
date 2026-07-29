import { z } from 'zod'

/**
 * The full set of environment variables the API understands, validated once at
 * boot. Anything missing or malformed fails fast with a readable error instead
 * of surfacing as an undefined-at-runtime bug later. Keep this in sync with
 * `.env.example`.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(3000),

  /**
   * Comma-separated list of allowed CORS origins, or `*` to allow any. Parsed
   * into a string array by {@link parseEnv}. Empty disables cross-origin access.
   */
  CORS_ORIGINS: z.string().default(''),

  /** Signing secret for JWT access/refresh tokens. Never commit a real value. */
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  /** WebSocket namespace for realtime gameplay. */
  WS_NAMESPACE: z.string().default('/game'),
  /** Server-side hard cap on players per room (design target: up to 100). */
  ROOM_MAX_PLAYERS: z.coerce.number().int().min(1).max(100).default(100)
})

export type RawEnv = z.infer<typeof envSchema>

/**
 * Structured, typed configuration derived from the raw env. This is the shape
 * the rest of the app consumes via {@link AppConfigService} — no component ever
 * reads `process.env` directly.
 */
export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV']
  isProduction: boolean
  http: {
    host: string
    port: number
    corsOrigins: string[] | boolean
  }
  jwt: {
    secret: string
    accessTtl: string
    refreshTtl: string
  }
  realtime: {
    namespace: string
    roomMaxPlayers: number
  }
}

/** Turn `CORS_ORIGINS` into what Fastify/Nest CORS expects: `true` (any), or an explicit list. */
function parseCorsOrigins(raw: string): string[] | boolean {
  const trimmed = raw.trim()
  if (trimmed === '') return false
  if (trimmed === '*') return true
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/** Validate `process.env` (or any record) and project it into {@link AppConfig}. Throws on invalid input. */
export function loadConfig(source: Record<string, unknown>): AppConfig {
  const env = envSchema.parse(source)
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    http: {
      host: env.API_HOST,
      port: env.API_PORT,
      corsOrigins: parseCorsOrigins(env.CORS_ORIGINS)
    },
    jwt: {
      secret: env.JWT_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL
    },
    realtime: {
      namespace: env.WS_NAMESPACE,
      roomMaxPlayers: env.ROOM_MAX_PLAYERS
    }
  }
}
