import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('password') // 'password' | 'magic-link'
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Fall back to sign-up on first run (no account exists yet).
      const { error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) {
        setStatus({ type: 'error', message: signUpError.message })
      } else {
        setStatus({ type: 'success', message: 'Account created. Check your email to confirm, then log in.' })
      }
    }
    setSubmitting(false)
  }

  async function handleMagicLinkSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })

    setStatus(
      error
        ? { type: 'error', message: error.message }
        : { type: 'success', message: 'Check your email for a login link.' }
    )
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
          Budget Tracker
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Sign in to sync your data across devices.</p>

        <div className="flex gap-2 mb-4 text-sm">
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`px-3 py-1.5 rounded-md transition ${mode === 'password' ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
          >
            Email + password
          </button>
          <button
            type="button"
            onClick={() => setMode('magic-link')}
            className={`px-3 py-1.5 rounded-md transition ${mode === 'magic-link' ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
          >
            Magic link
          </button>
        </div>

        <form onSubmit={mode === 'password' ? handlePasswordSubmit : handleMagicLinkSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />

          {mode === 'password' && (
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 dark:bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
          >
            {mode === 'password' ? 'Sign in / Sign up' : 'Send magic link'}
          </button>
        </form>

        {status && (
          <p className={`mt-4 text-sm ${status.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {status.message}
          </p>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
          <ul className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500" aria-hidden>🔒</span>
              <span>Your data is private to your account — we never sell it or show ads.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500" aria-hidden>🏦</span>
              <span>Bank connections are read-only and handled securely by Plaid.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500" aria-hidden>🔑</span>
              <span>Optional two-factor authentication for an extra layer of security.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
