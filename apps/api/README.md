# @tetris/api

NestJS + Fastify backend for **tetris.ts** — REST + WebSocket in a single
process. This is the *foundation*: a clean, runnable, tested modular monolith
that the authentication, rooms and (up to 100-player) multiplayer features grow
into. It is deliberately **not** a finished multiplayer server yet — see
[Next steps](#next-steps).

## Requirements

- Node ≥ 20, pnpm (the repo pins `pnpm@10` via `packageManager`)
- Run everything from the repo root with pnpm workspaces.

## Install

```bash
pnpm install            # from the monorepo root
```

## Configuration

Configuration is read from environment variables, **validated once at boot**
with zod (`src/config/env.schema.ts`) — the process refuses to start if anything
is missing or malformed. Copy the template and edit it:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable           | Required | Default     | Purpose                                                        |
| ------------------ | -------- | ----------- | -------------------------------------------------------------- |
| `NODE_ENV`         | no       | development | `development` \| `test` \| `production`                        |
| `API_HOST`         | no       | 0.0.0.0     | HTTP bind address                                              |
| `API_PORT`         | no       | 3000        | HTTP port                                                      |
| `CORS_ORIGINS`     | no       | *(empty)*   | Comma-separated origins, `*` for any, empty to disable         |
| `JWT_SECRET`       | **yes**  | —           | JWT signing secret (min 16 chars) — never commit a real value  |
| `JWT_ACCESS_TTL`   | no       | 15m         | Access-token lifetime                                          |
| `JWT_REFRESH_TTL`  | no       | 7d          | Refresh-token lifetime                                         |
| `WS_NAMESPACE`     | no       | /game       | WebSocket namespace for gameplay                               |
| `ROOM_MAX_PLAYERS` | no       | 100         | Server-wide cap on players per room                            |

No real secret is committed; `.env` is git-ignored.

## Run

```bash
# From the repo root:
pnpm dev:api            # watch mode (SWC), rebuilds @tetris/protocol first
pnpm build:api          # compile to apps/api/dist (SWC)
pnpm start:api          # run the built server (node dist/main.js)

# Quality:
pnpm typecheck:api      # tsc --noEmit
pnpm test:api           # vitest (unit + e2e)
```

`dev:api` / `build:api` / `test:api` build `@tetris/protocol` first (it ships a
dual ESM+CJS bundle the server requires at runtime).

## REST endpoints

All REST routes are prefixed with **`/api`**. DTOs are validated by a global
strict `ValidationPipe` (type transform on, unknown properties rejected,
whitelist on); errors come back in one consistent shape.

| Method | Path             | Auth   | Description                                    |
| ------ | ---------------- | ------ | ---------------------------------------------- |
| GET    | `/api/health`    | public | Status, ISO timestamp, uptime, environment     |
| POST   | `/api/auth/register` | public | Create an account, returns user + tokens   |
| POST   | `/api/auth/login`    | public | Authenticate, returns user + tokens        |
| POST   | `/api/auth/refresh`  | public | Exchange a refresh token for a new pair     |
| GET    | `/api/auth/me`       | bearer | The current user (from the access token)    |

Every route is protected by a global JWT guard unless marked `@Public()`.

## WebSocket events (prepared)

Gateway namespace: **`/game`** (`WS_NAMESPACE`). Every inbound payload is
validated with the shared `@tetris/protocol` zod schemas; every outbound message
is a versioned envelope (`protocolVersion`, `seq`, `ts`, `data`). Player actions
carry a client sequence number.

Client → server: `authenticate`, `room:create`, `room:join`, `room:leave`,
`player:ready`, `game:start`, `player:action`.

Server → client: `connected`, `error`, `room:created`, `room:joined`,
`room:left`, `room:state`, `game:started`, `game:snapshot`, `game:attack`,
`game:elimination`, `game:over`.

> Opponent **snapshots** must be down-sampled to ~**5–10 Hz** — never the full
> 60 Hz board. The gateway wires the events and validation; the fixed-timestep
> simulation loop and snapshot fan-out are the next step.

## Architecture

- **Modular monolith.** REST and WebSocket in one deployment. Modules —
  `Config`, `Health`, `Auth`, `Users`, `Rooms`, `Games`, `Realtime` — are split
  along likely future scaling seams, *not* prematurely into microservices.
- **Fastify adapter** (`@nestjs/platform-fastify`) for the HTTP server.
- **SWC** transpiles the app (native decorator-metadata support); tests run on
  **Vitest** (the repo's runner) via `unplugin-swc`.
- **Typed, validated config** — no component reads `process.env` directly.
- **Shared contract** lives in [`@tetris/protocol`](../../packages/protocol):
  protocol version, event names, zod schemas and message types. It depends only
  on `zod` — no NestJS, no rendering — so it couples the client to nothing.
  Decorated NestJS DTOs stay server-side.
- **Authoritative engine reuse.** The server drives the *same*
  [`@tetris/engine`](../../packages/engine) as the client through
  `AuthoritativeGameSession` (`src/games/`). The engine is pure and deterministic
  (injectable RNG), so given a seed and ordered inputs the server can
  validate/re-simulate a run. The engine is **not modified**; the session only
  adds server concerns (input sequencing, snapshots).
- **Scaling seam without the cost.** A `PubSub` abstraction (`src/common/pubsub`)
  is backed by an in-process emitter now — **no Redis** — but is the single place
  a Redis/NATS adapter plugs in when multiple instances are deployed. No Kafka,
  no RabbitMQ, no microservices.

### Persistence

Auth flows (register/login/refresh/me) are fully implemented over a
storage-agnostic `UserRepository` interface with **Argon2id** password hashing.
The current binding is a **dev-only in-memory store** that *refuses to run in
production*. It is not presented as a final solution.

**Recommended next step:** implement `PrismaUserRepository` (PostgreSQL) against
the same interface and bind it in `UsersModule` — no other code changes. Prisma
+ Postgres is the intended production store; it was left as a documented seam
here because no flow in this foundation strictly requires a database yet.

## Testing

```bash
pnpm test:api
```

- `test/health.e2e-spec.ts` — boots the real Fastify app and hits `/api/health`.
- `src/**/*.spec.ts` — unit tests for config validation, rooms rules, health,
  and the authoritative session driving the **real** engine.

## Next steps

1. `PrismaUserRepository` (PostgreSQL) + migrations.
2. Refresh-token rotation/revocation and rate limiting on auth.
3. The authoritative fixed-timestep game loop in `GamesService`, seeded per
   match, with ~5–10 Hz opponent snapshots (delta/RLE board encoding).
4. Garbage/attack routing and elimination/standings over the `PubSub` bus.
5. A Redis `PubSub` adapter + socket.io Redis adapter once load is measured and
   a second instance is justified.
