/**
 * The shared simulation clock. Both sides must agree on these exactly — they
 * define what a "tick" means, and a tick is the unit the whole netcode is
 * built on. They live in the protocol package precisely so neither side can
 * drift its own copy.
 */

/**
 * Milliseconds per simulation step (~60 Hz).
 *
 * Every engine advance on both client and server is exactly this long. The
 * client deliberately does *not* advance by frame delta: a variable step makes
 * two engines that received identical inputs land on different boards, which is
 * the entire class of bug this timeline exists to remove.
 */
export const TICK_MS = 16

/**
 * How far the server will rewind to honor a late input (~128 ms).
 *
 * Sets the latency budget: an input survives a one-way trip of up to this long.
 * Beyond it the input is clamped forward and the client is corrected, which is
 * visible as a small snap — correct, but not free, so the window is generous
 * enough that it stays rare on a normal connection.
 */
export const ROLLBACK_WINDOW_TICKS = 8

/**
 * How far ahead of the confirmed tick a garbage delivery is scheduled (~256 ms).
 *
 * Garbage is a cross-player effect, so it is only ever derived from confirmed
 * state, which already lags the server's live tick by the rollback window. This
 * lead time is what still leaves the recipient room to receive the delivery
 * before the tick it lands on.
 */
export const GARBAGE_DELAY_TICKS = 16

/** How often the server sends each player an authoritative baseline of their own board. */
export const CORRECTION_INTERVAL_TICKS = 60

/**
 * How far ahead of the server's current tick an input may be stamped (~1 s).
 *
 * A correctly paced client stamps barely one tick ahead. The allowance covers
 * clock-estimate error and a burst of catch-up; past it the stamp is not a
 * pacing artifact but a client asking the server to hold an input indefinitely,
 * so it is clamped. Without a bound, unique far-future ticks accumulate in the
 * per-player queue and never age out.
 */
export const MAX_INPUT_LEAD_TICKS = 60

/**
 * Hard cap on inputs queued for one player. A second guard behind
 * {@link MAX_INPUT_LEAD_TICKS}: even entirely in-range stamps must not let a
 * chatty client grow server memory without limit.
 */
export const MAX_QUEUED_INPUTS = 512

/** Convert a wall-clock epoch offset into a tick index. */
export function tickAt(nowMs: number, startedAt: number): number {
  return Math.max(0, Math.floor((nowMs - startedAt) / TICK_MS))
}
