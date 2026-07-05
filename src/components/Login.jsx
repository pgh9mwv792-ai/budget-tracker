import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const LAST_EMAIL_KEY = 'bt_last_email'

// Generates a strong random password (16 chars, guaranteed a mix of classes).
// Runs entirely in the browser using the Web Crypto API.
function generatePassword(length = 16) {
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%^&*-_=+'
  const all = lower + upper + digits + symbols
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length]

  // Guarantee at least one of each class, then fill the rest randomly.
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)]
  while (chars.length < length) chars.push(pick(all))

  // Fisher–Yates shuffle so the guaranteed characters aren't always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'magic'
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [canResend, setCanResend] = useState(false)

  const rememberEmail = (value) => localStorage.setItem(LAST_EMAIL_KEY, value.trim())

  async function handleSignIn(e) {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    setCanResend(false)

    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      // Surface the ACTUAL reason instead of silently trying to sign up again.
      const msg = error.message || 'Could not sign in.'
      const notConfirmed = /confirm/i.test(msg)
      setStatus({
        type: 'error',
        message: notConfirmed
          ? 'Your email hasn’t been confirmed yet. Check your inbox, or resend the link below.'
          : msg,
      })
      setCanResend(notConfirmed)
    } else {
      rememberEmail(email)
    }
    setSubmitting(false)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    setCanResend(false)

    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
    if (error) {
      setStatus({ type: 'error', message: error.message })
    } else if (data.session) {
      // Email confirmation is disabled on the project — the user is already
      // signed in, nothing more to do.
      rememberEmail(email)
    } else {
      rememberEmail(email)
      setStatus({
        type: 'success',
        message: 'Account created! Check your email to confirm your address, then come back and sign in.',
      })
    }
    setSubmitting(false)
  }

  async function handleMagicLink(e) {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    setCanResend(false)

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    rememberEmail(email)
    setStatus(
      error
        ? { type: 'error', message: error.message }
        : { type: 'success', message: 'Check your email for a login link.' }
    )
    setSubmitting(false)
  }

  async function resendConfirmation() {
    setSubmitting(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setStatus(
      error
        ? { type: 'error', message: error.message }
        : { type: 'success', message: 'Confirmation email sent — check your inbox.' }
    )
    setCanResend(false)
    setSubmitting(false)
  }

  const onSubmit = mode === 'signin' ? handleSignIn : mode === 'signup' ? handleSignUp : handleMagicLink

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
          Budget Tracker
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Sign in to sync your data across devices.</p>

        <div className="grid grid-cols-3 gap-1 mb-4 text-sm p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
          {[
            ['signin', 'Sign in'],
            ['signup', 'Create account'],
            ['magic', 'Magic link'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMode(key)
                setStatus(null)
                setCanResend(false)
              }}
              className={`px-2 py-1.5 rounded-md transition ${
                mode === key
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-medium'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />

          {mode !== 'magic' && (
            <div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>

              {mode === 'signup' && (
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generatePassword())
                    setShowPassword(true)
                  }}
                  className="mt-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  🔑 Generate a strong password
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 dark:bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
          >
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send magic link'}
          </button>
        </form>

        {mode === 'signup' && password && showPassword && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Save this password somewhere safe — your browser or password manager can store it for you.
          </p>
        )}

        {status && (
          <div className="mt-4">
            <p className={`text-sm ${status.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {status.message}
            </p>
            {canResend && (
              <button
                type="button"
                onClick={resendConfirmation}
                disabled={submitting}
                className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50"
              >
                Resend confirmation email
              </button>
            )}
          </div>
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
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline"
          >
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  )
}
