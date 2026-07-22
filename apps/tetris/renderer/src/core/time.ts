/** Format milliseconds as a clock string: `m:ss`, or `m:ss.d` with tenths. */
export function formatClock(ms: number, withTenths = false): string {
  const totalMs = Math.max(0, Math.round(ms))
  const totalSeconds = Math.floor(totalMs / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  const base = `${m}:${String(s).padStart(2, '0')}`
  if (!withTenths) return base
  const tenths = Math.floor((totalMs % 1000) / 100)
  return `${base}.${tenths}`
}
