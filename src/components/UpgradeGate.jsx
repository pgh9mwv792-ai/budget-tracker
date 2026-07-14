import { useState } from 'react'
import { startCheckout } from '../lib/billing'

// What Pro unlocks — shown on every upgrade card so the value is always clear.
const PRO_PERKS = [
  'Automatic bank & credit-card import (Plaid)',
  'The AI assistant that answers questions and makes changes',
  'Everything in Free: manual tracking, budgets, goals, meals, receipt scan',
]

// Wraps a Pro-only piece of UI. For Pro users it renders children unchanged; for
// free users it shows a clean upgrade card with a Subscribe button that kicks
// off Stripe Checkout. `title`/`blurb` tailor the card to the gated feature.
export default function UpgradeGate({ plan, title, blurb, children }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (plan === 'pro') return children

  async function subscribe() {
    setBusy(true)
    setError(null)
    try {
      await startCheckout() // redirects to Stripe on success
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/10 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">✨</span>
        <h3 className="font-semibold text-text">{title || 'Upgrade to Pro'}</h3>
      </div>
      {blurb && <p className="text-sm text-text-muted">{blurb}</p>}
      <ul className="space-y-1.5">
        {PRO_PERKS.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm text-text">
            <span className="text-interactive">✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={subscribe}
          disabled={busy}
          className="rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm px-4 py-2 font-medium transition disabled:opacity-50"
        >
          {busy ? 'Opening checkout…' : 'Subscribe — $6/mo'}
        </button>
        <span className="text-xs text-text-muted">Cancel anytime.</span>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}
