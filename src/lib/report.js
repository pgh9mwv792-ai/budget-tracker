import * as Sentry from '@sentry/react'

// Sends a handled (caught) error to Sentry with a little extra context so it's
// findable there — the ErrorBoundary in main.jsx only catches errors that crash
// a render, so anything we catch in a try/catch has to be reported explicitly.
// Safe when Sentry isn't initialized (no DSN in local dev): captureException is
// a no-op then, so this never throws and never blocks the UI path.
export function reportError(err, context) {
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined)
  } catch {
    // Never let error reporting itself break the app.
  }
}
