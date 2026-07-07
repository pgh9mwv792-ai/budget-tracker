import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { supabase } from '../lib/supabaseClient'

async function callFunction(name, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    // supabase.functions.invoke hides our function's error body on a non-2xx
    // response, so dig the real message out of error.context. Build the message
    // first, THEN throw — throwing inside the try would be caught right below and
    // swallow the real message, leaving only the generic "non-2xx" text.
    let message = error.message
    try {
      const details = await error.context.json()
      if (details?.error) message = details.error
    } catch {
      // keep the fallback message
    }
    throw new Error(message)
  }
  return data
}

export default function PlaidLinkButton({ onLinked, onSync }) {
  const [linkToken, setLinkToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    callFunction('plaid-create-link-token', {})
      .then((data) => setLinkToken(data.link_token))
      .catch((e) => setError(e.message))
  }, [])

  const onSuccess = useCallback(
    async (publicToken, metadata) => {
      setBusy(true)
      setError(null)
      setStatus(null)
      try {
        await callFunction('plaid-exchange-public-token', {
          public_token: publicToken,
          institution_name: metadata.institution?.name,
        })
        setStatus('Bank connected. Now click "Sync transactions".')
        onLinked?.()
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(false)
      }
    },
    [onLinked]
  )

  // Fires if the user closes Plaid Link without finishing (or Plaid errors
  // mid-flow). Without this, an early exit is silent and looks like "nothing
  // happened" — which is exactly the confusing case we hit.
  const onExit = useCallback((err) => {
    if (err) {
      setError(`Plaid exited: ${err.error_message || err.error_code || 'unknown error'}`)
    } else {
      setStatus('You closed the bank connection before finishing — nothing was linked. Click "Connect a bank" and complete all the steps (including choosing an account).')
    }
  }, [])

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit })

  async function handleSync(full = false) {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await callFunction('plaid-sync-transactions', full ? { full: true } : {})
      setStatus(
        full
          ? `Re-imported ${result.imported} transaction(s) and refreshed balances.`
          : result.imported > 0
            ? `Imported ${result.imported} transaction(s).`
            : 'No new transactions found (they may not be ready yet — wait a few seconds and sync again).'
      )
      onSync?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => open()}
        disabled={!ready || busy}
        className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-3 py-1.5 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
      >
        Connect a bank or credit card
      </button>
      <button
        onClick={() => handleSync(false)}
        disabled={busy}
        className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-3 py-1.5 disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Sync transactions'}
      </button>
      <button
        onClick={() => handleSync(true)}
        disabled={busy}
        title="Re-import your full history and re-classify it — use this once to fix transfers that were counted as income."
        className="rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition text-sm px-2 py-1.5 disabled:opacity-50 underline decoration-dotted"
      >
        Re-import &amp; fix
      </button>
      {status && <span className="text-sm text-slate-600 dark:text-slate-300 w-full sm:w-auto">{status}</span>}
      {error && <span className="text-sm text-red-600 dark:text-red-400 w-full sm:w-auto">{error}</span>}
      <p className="w-full text-xs text-slate-500 dark:text-slate-400">
        To add a credit card, click <span className="font-medium">Connect a bank or credit card</span> and
        sign in to the company that issued the card (like Chase, Capital One, or Amex). Your card — with its
        balance and limit — gets added automatically along with any checking or savings accounts there.
      </p>
    </div>
  )
}
