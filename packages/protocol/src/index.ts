/**
 * `@tetris/protocol` — the framework-free contract shared by the Tetris client
 * and server. It contains only the wire protocol: a version, the event names,
 * the runtime schemas for inbound payloads and the types for outbound ones.
 *
 * It depends on `zod` and nothing else — no NestJS, no Fastify, no rendering,
 * no engine — so importing it never drags a framework into the other side.
 */
export * from './version'
export * from './events'
export * from './schemas'
export * from './messages'
export * from './timing'
