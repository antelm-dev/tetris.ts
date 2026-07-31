import type { LogLevel } from '@nestjs/common'

/** Least to most verbose. Enabling a level enables everything above it. */
const ORDER: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose']

/**
 * Expand a threshold (`LOG_LEVEL`) into the level list Nest's logger expects.
 * An unrecognized threshold falls back to `log` — silently disabling every
 * level is a far worse failure than being slightly too chatty.
 */
export function levelsFor(threshold: LogLevel): LogLevel[] {
  const index = ORDER.indexOf(threshold)
  return ORDER.slice(0, (index === -1 ? ORDER.indexOf('log') : index) + 1)
}
