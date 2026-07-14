import { useMemo, useState } from 'react'
import { analyzeRecurring } from '../lib/analysis'
import { cleanMerchantName } from '../lib/receiptMatch'

// The "Needs review" inbox strip at the top of the Transactions feed. It gathers
// the few things that actually want a decision — uncategorized transactions,
// scanned receipts that never matched a charge, suspected transfer pairs, and
// unconfirmed recurring charges — into one collapsible strip. It renders NOTHING
// when there's nothing to review. Acting on a card animates it out.
export default function NeedsReview({
  transactions,
  categories,
  onAssignCategory,
  onApplyRules,
  savedMatchCount = 0,
  receipts = [],
  suspectedPairs = [],
  onConfirmPair,
  onDismissPair,
  recurringOverrides = [],
  onSetRecurringOverride,
}) {
  const [collapsed, setCollapsed] = useState(false)
  // Ids currently playing their exit animation before the source data drops them.
  const [hiding, setHiding] = useState(() => new Set())

  const animateOut = (id, action) => {
    setHiding((prev) => new Set(prev).add(id))
    setTimeout(() => {
      Promise.resolve(action?.()).finally(() => {
        setHiding((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      })
    }, 200)
  }
  const rowCls = (id) =>
    `transition-all duration-200 ${hiding.has(id) ? 'opacity-0 -translate-x-2' : 'opacity-100'}`

  const uncategorized = useMemo(
    () => transactions.filter((t) => !t.category_id && t.kind !== 'transfer'),
    [transactions]
  )
  const unmatchedReceipts = useMemo(
    () => receipts.filter((r) => !r.matched_transaction_id),
    [receipts]
  )
  const overridesMap = useMemo(
    () => new Map(recurringOverrides.map((o) => [o.merchant_key, o])),
    [recurringOverrides]
  )
  const pendingSubs = useMemo(() => {
    const groups = analyzeRecurring(transactions, { overrides: overridesMap })
    return groups.filter((g) => g.classification === 'subscription' && !overridesMap.get(g.key)?.status)
  }, [transactions, overridesMap])

  const total =
    uncategorized.length + unmatchedReceipts.length + suspectedPairs.length + pendingSubs.length
  if (total === 0) return null

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-primary-tint transition"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-text">
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-warning text-on-primary text-xs font-bold">
            {total}
          </span>
          Needs review
        </span>
        <span className="text-sm text-text-muted">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          {/* Uncategorized transactions */}
          {uncategorized.length > 0 && (
            <Card
              title={`Uncategorized (${uncategorized.length})`}
              action={
                savedMatchCount > 0 && (
                  <button
                    onClick={onApplyRules}
                    className="shrink-0 rounded-md bg-warning hover:bg-warning/90 text-on-primary text-xs font-medium px-2.5 py-1 transition"
                  >
                    Auto-categorize {savedMatchCount} with saved rules
                  </button>
                )
              }
            >
              <div className="space-y-2">
                {uncategorized.map((t) => (
                  <div
                    key={t.id}
                    className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm ${rowCls(t.id)}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-text-muted shrink-0">{t.date}</span>
                      <span className={`shrink-0 font-medium ${t.kind === 'income' ? 'text-success' : 'text-danger'}`}>
                        {t.kind === 'income' ? '+' : '−'}${Number(t.amount).toFixed(2)}
                      </span>
                      <span className="text-text-muted truncate">
                        {cleanMerchantName(t.merchant_name || t.note || '') || t.note}
                      </span>
                    </div>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) animateOut(t.id, () => onAssignCategory(t.id, v))
                      }}
                      className="w-full sm:w-auto rounded-md border border-border bg-surface text-text px-2 py-2 sm:py-1 text-sm shrink-0 focus:outline-none focus:ring-2 focus:ring-interactive/40"
                    >
                      <option value="" disabled>
                        Assign category…
                      </option>
                      {categories
                        .filter((c) => c.kind === t.kind)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Suspected transfer pairs */}
          {suspectedPairs.length > 0 && (
            <Card title={`Possible transfers (${suspectedPairs.length})`}>
              <div className="space-y-2">
                {suspectedPairs.map((p) => {
                  const key = `${p.a.id}-${p.b.id}`
                  return (
                    <div
                      key={key}
                      className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm ${rowCls(key)}`}
                    >
                      <div className="min-w-0">
                        <p className="text-text">
                          These look like the same payment — combine?
                        </p>
                        <p className="text-xs text-text-muted truncate">
                          ${Number(p.a.amount).toFixed(2)} · {p.reason}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => animateOut(key, () => onConfirmPair(p))}
                          className="rounded-md bg-primary hover:bg-primary-hover text-on-primary text-xs font-medium px-2.5 py-1.5 transition"
                        >
                          Combine
                        </button>
                        <button
                          onClick={() => animateOut(key, () => onDismissPair(p))}
                          className="rounded-md border border-border text-text hover:bg-primary-tint text-xs font-medium px-2.5 py-1.5 transition"
                        >
                          Not the same
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Unmatched scanned receipts */}
          {unmatchedReceipts.length > 0 && (
            <Card title={`Unmatched receipts (${unmatchedReceipts.length})`}>
              <div className="space-y-2">
                {unmatchedReceipts.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-text">
                      {r.store_name || 'Receipt'}{' '}
                      <span className="text-text-muted">· {r.purchase_date}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-text-muted">
                      ${Number(r.total ?? 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Pending subscription confirmations */}
          {pendingSubs.length > 0 && (
            <Card title={`Recurring charges to confirm (${pendingSubs.length})`}>
              <div className="space-y-2">
                {pendingSubs.map((g) => (
                  <div
                    key={g.key}
                    className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm ${rowCls(g.key)}`}
                  >
                    <div className="min-w-0">
                      <span className="truncate text-text">{g.label}</span>
                      <p className="text-xs text-text-muted">
                        ${g.amount.toFixed(2)} · {g.cadence}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          animateOut(g.key, () =>
                            onSetRecurringOverride(g.key, { status: 'confirmed', nickname: g.nickname })
                          )
                        }
                        className="rounded-md border border-success/30 text-success hover:bg-success/10 text-xs font-medium px-2.5 py-1.5 transition"
                      >
                        Confirm recurring
                      </button>
                      <button
                        onClick={() =>
                          animateOut(g.key, () =>
                            onSetRecurringOverride(g.key, { status: 'not_recurring', nickname: g.nickname })
                          )
                        }
                        className="rounded-md border border-border text-text hover:bg-primary-tint text-xs font-medium px-2.5 py-1.5 transition"
                      >
                        Not recurring
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </section>
  )
}

function Card({ title, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}
