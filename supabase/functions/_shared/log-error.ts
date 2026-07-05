// Structured error logging for Edge Functions. Supabase captures each function's
// stderr in its dashboard logs, so emitting one JSON line per failure makes
// errors searchable there without any extra service. Returns the human-readable
// message so a caller can log and surface it in the same step.
export function logError(fn: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
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
