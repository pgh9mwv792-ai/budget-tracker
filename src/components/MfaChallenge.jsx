import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

// Shown after sign-in when the account has 2FA enabled. The user must enter a
// current code from their authenticator app to reach aal2 before the app opens.
export default function MfaChallenge() {
  const { refreshAal, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors()
      if (listErr) throw listErr
      const totp = factors.totp?.[0]
      if (!totp) throw new Error('No authenticator is set up on this account.')

      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (challErr) throw challErr

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code: code.trim(),
      })
      if (verifyErr) throw verifyErr

      await refreshAal() // clears needsMfa -> app renders
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Two-factor authentication</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          Enter the 6-digit code from your authenticator app to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full rounded-md bg-slate-900 dark:bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          onClick={signOut}
          className="mt-5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
