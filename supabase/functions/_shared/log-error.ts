// Structured error logging for Edge Functions. Supabase captures each function's
// stderr in its dashboard logs, so emitting one JSON line per failure makes
// errors searchable there without any extra service. Returns the human-readable
// message so a caller can log and surface it in the same step.
export function logError(fn: string, err: unknown): string {
  // Supabase/PostgREST errors are thrown as plain objects ({ message, details,
  // hint, code }), not Error instances — String(err) on those yields the useless
  // "[object Object]". Pull the real fields out (and fall back to JSON) so the
  // caller surfaces something actionable.
  let message: string
  if (err instanceof Error) {
    message = err.message
  } else if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    const parts = [o.message, o.details, o.hint, o.code].filter(
      (v) => typeof v === 'string' && v.length > 0,
    )
    message = parts.length ? parts.join(' — ') : JSON.stringify(err)
  } else {
    message = String(err)
  }
  console.error(
    JSON.stringify({
      level: 'error',
      fn,
      message,
      stack: err instanceof Error ? err.stack : undefined,
      at: new Date().toISOString(),
    }),
  )
  return message
}
