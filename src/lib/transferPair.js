// ---------------------------------------------------------------------------
// Pure transfer-pairing matcher. A move of your own money between two accounts
// (savings -> checking, or a credit-card PAYMENT from checking to the card)
// arrives from Plaid as TWO transactions — one on each account, both already
// kind='transfer'. This finds the two legs that belong together so the UI can
// render them as a single combined row.
//
// It NEVER merges, edits, or deletes anything — it only proposes links. The two
// underlying transactions always persist untouched.
//
// No Supabase, no React, no I/O — pure functions over the transactions already
// loaded in App.jsx, so it's identical in the browser and in a test runner and
// could move server-side later unchanged.
// ---------------------------------------------------------------------------

import { daysBetween } from './dateHelpers'
// Reuse the authorized-date extraction from the receipt matcher: a card prints
// "AUTHORIZED ON MM/DD" (the real swipe date). The two legs of one transfer can
// post a day or two apart, but their authorized dates line up, so we compare on
// the authorized date when present and fall back to the posted date.
import { descriptorPurchaseDate, txnDescriptorText } from './receiptMatch'

// The two legs of one transfer post within a few days of each other. Anything
// past this window is not a pair. A gap sitting exactly ON the window edge is
// "suspected" (surfaced for confirmation), never auto-linked.
const WINDOW_DAYS = 4
// Amounts must be equal to the cent to auto-pair. A 1–2¢ difference (a rounding
// or FX artifact) is "suspected" only.
const NEAR_CENTS = 2

// numeric(12,2) money → integer cents. Transactions store the ABSOLUTE amount
// (the sign/direction isn't persisted), so we compare magnitudes.
function toCents(n) {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
}

// The date we compare a leg on: its authorized (swipe) date if the descriptor
// carries one, else its posted date.
function effectiveDate(t) {
  return descriptorPurchaseDate(txnDescriptorText(t), t?.date) ?? t?.date
}

const rankStatus = (s) => (s === 'auto' ? 0 : 1)

// -----------------------------------------------------------------------------
// pairTransfers(transactions, opts)
//
// transactions: the array loaded in App.jsx (each { id, date, amount, kind,
//   account_id, note/merchant_name }).
// opts.alreadyPairedIds: iterable of transaction ids already in a saved pair —
//   excluded so we never propose a leg that's already linked.
// opts.signOf(t): OPTIONAL. Returns -1 / 0 / +1 for a leg's direction (out / in).
//   When BOTH legs of a candidate report a nonzero direction, they must be
//   OPPOSITE (one out, one in). Direction isn't stored on our transactions, so
//   the default is a no-op and pairing rests on the other criteria; a caller
//   that can infer direction (e.g. from account type) can tighten it.
//
// Returns { autoPairs, suspectedPairs }. Each entry is
//   { a, b, gapDays, amountDeltaCents, status, reason }.
//   • autoPairs      — exact amount, different accounts, comfortably inside the
//     date window. Safe to link automatically (status 'auto').
//   • suspectedPairs — exact amount but the dates sit on the window boundary, OR
//     amounts within 2¢. Surfaced for a one-tap confirm; NEVER auto-linked.
//
// Hard rules:
//   • both legs kind='transfer', two DIFFERENT transactions.
//   • different account_id (and both present) — a leg can't pair within its own
//     account, and we can't confirm "different accounts" without both ids.
//   • absolute amounts equal to the cent (auto) or within 2¢ (suspected).
//   • effective dates within WINDOW_DAYS.
//   • each transaction lands in at most one proposed pair (greedy, best first).
// Pure: no mutation of inputs.
// -----------------------------------------------------------------------------
export function pairTransfers(transactions = [], opts = {}) {
  const alreadyPaired = new Set([...(opts.alreadyPairedIds ?? [])].map(String))
  const signOf = typeof opts.signOf === 'function' ? opts.signOf : () => 0

  const legs = transactions.filter(
    (t) => t && t.kind === 'transfer' && t.account_id && !alreadyPaired.has(String(t.id))
  )

  const candidates = []
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i]
      const b = legs[j]
      if (String(a.account_id) === String(b.account_id)) continue // same account ≠ pair

      const ca = toCents(a.amount)
      const cb = toCents(b.amount)
      if (!Number.isFinite(ca) || !Number.isFinite(cb)) continue
      const centsDiff = Math.abs(ca - cb)
      if (centsDiff > NEAR_CENTS) continue

      const sa = signOf(a)
      const sb = signOf(b)
      if (sa && sb && sa === sb) continue // known same-direction → not two legs

      const gap = Math.abs(daysBetween(effectiveDate(a), effectiveDate(b)))
      if (!Number.isFinite(gap) || gap > WINDOW_DAYS) continue

      const exact = centsDiff === 0
      let status
      if (exact && gap < WINDOW_DAYS) status = 'auto'
      else if (exact && gap === WINDOW_DAYS) status = 'suspected' // dates on the boundary
      else if (!exact) status = 'suspected' // amount within 2¢
      else continue

      candidates.push({ a, b, gap, centsDiff, status })
    }
  }

  // Best first: auto before suspected, then closest dates, then closest amounts.
  candidates.sort(
    (x, y) => rankStatus(x.status) - rankStatus(y.status) || x.gap - y.gap || x.centsDiff - y.centsDiff
  )

  const used = new Set()
  const autoPairs = []
  const suspectedPairs = []
  for (const c of candidates) {
    if (used.has(c.a.id) || used.has(c.b.id)) continue
    used.add(c.a.id)
    used.add(c.b.id)
    const entry = {
      a: c.a,
      b: c.b,
      gapDays: c.gap,
      amountDeltaCents: c.centsDiff,
      status: c.status,
      reason:
        c.status === 'auto'
          ? 'exact amount between two accounts, within a few days'
          : c.centsDiff === 0
            ? `exact amount, but the dates are ${c.gap} days apart`
            : `amounts differ by ${c.centsDiff}¢ — likely the same payment`,
    }
    ;(c.status === 'auto' ? autoPairs : suspectedPairs).push(entry)
  }

  return { autoPairs, suspectedPairs }
}
