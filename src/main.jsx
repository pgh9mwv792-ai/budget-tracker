import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import AppCrash from './components/AppCrash.jsx'

// Error monitoring. The DSN is a public value (safe in the frontend); when it's
// not set — local dev, or before the Sentry project is created — init is skipped
// and Sentry becomes a no-op, so nothing breaks.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Only report actual errors for now — no performance/session tracing, to
    // stay well within the free tier.
    tracesSampleRate: 0,
  })
}

// Note: React.StrictMode is intentionally NOT used here. In development it
// double-mounts components, which makes Plaid Link initialize twice ("script
// embedded more than once") and can stop the onSuccess callback from firing
// after you finish connecting a bank.
createRoot(document.getElementById('root')).render(
  <Sentry.ErrorBoundary fallback={<AppCrash />}>
    <App />
  </Sentry.ErrorBoundary>,
)
