import { useMemo, useState } from 'react'
import { analyzeRecurring, recurringBurn } from '../lib/analysis'

// Subscriptions & recurring charges. Sits at the top of the Transactions tab as
// a compact summary strip ("Recurring: $X/mo · view all") that expands to the
// full breakdown. Everything here is derived from the transaction history via
// analyzeRecurring — with no bank sync there's simply nothing to show, so the
// whole section self-hides.
export default function Subscriptions({ transactions, overrides = [], onSetOverride, onClearOverride }) {
  const [expanded, setExpanded] = useState(false)

  const overridesMap = useMemo(() => new Map(overrides.map((o) => [o.merchant_key, o])), [overrides])
  const groups = useMemo(
    () => analyzeRecurring(transactions, { overrides: overridesMap }),
    [transactions, overridesMap]
  )
  const burn = useMemo(() => recurringBurn(groups), [groups])

  if (groups.length === 0) return null

  const subscriptions = groups.filter((g) => g.classification === 'subscription')
  const bills = groups.filter((g) => g.classification === 'bill')

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-surface shadow-sm px-4 py-3 text-left hover:bg-bg transition"
      >
        <span className="flex items-center gap-2 text-sm text-text">
          <span className="inline-block w-2 h-2 rounded-full bg-interactive" />
          Recurring:{' '}
          <b className="text-text">{money(burn.monthly)}/mo</b>
          <span className="text-text-muted">· {burn.count} charges</span>
        </span>
        <span className="text-sm font-medium text-interactive">view all →</span>
      </button>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            <span className="inline-block w-2 h-2 rounded-full bg-interactive" />
            Recurring &amp; subscriptions
          </div>
          <p className="mt-1 text-3xl font-bold tracking-tight text-text">
            {money(burn.monthly)}
            <span className="ml-1 text-sm font-normal text-text-muted">/ month</span>
          </p>
          <p className="text-sm text-text-muted">
            about <b className="text-text">{money(burn.annual)}</b> a year across{' '}
            {burn.count} charges
          </p>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="shrink-0 text-sm font-medium text-text-muted hover:text-text"
        >
          Collapse
        </button>
      </div>

      <div className="p-4 space-y-5">
        <Group
          title="Subscriptions"
          items={subscriptions}
          overridesMap={overridesMap}
          onSetOverride={onSetOverride}
          onClearOverride={onClearOverride}
        />
        <Group
          title="Bills"
          items={bills}
          overridesMap={overridesMap}
          onSetOverride={onSetOverride}
          onClearOverride={onClearOverride}
        />
      </div>
    </section>
  )
}

function Group({ title, items, overridesMap, onSetOverride, onClearOverride }) {
  if (items.length === 0) return null
  return (
    <div>
      <h4 className="text-sm font-semibold text-text mb-1">{title}</h4>
      <div className="divide-y divide-border rounded-lg border border-border">
        {items.map((g) => (
          <Row
            key={g.key}
            g={g}
            override={overridesMap.get(g.key) ?? null}
            onSetOverride={onSetOverride}
            onClearOverride={onClearOverride}
          />
        ))}
      </div>
    </div>
  )
}

function Row({ g, override, onSetOverride, onClearOverride }) {
  const [open, setOpen] = useState(false)
  const [nickname, setNickname] = useState(g.nickname ?? '')

  const currentStatus = override?.status ?? null

  const setStatus = (status) => onSetOverride?.(g.key, { status, nickname: g.nickname })
  const saveNickname = () => onSetOverride?.(g.key, { status: currentStatus ?? 'confirmed', nickname })

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-bg transition"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text">{g.label}</span>
            <StatusBadge g={g} />
          </div>
          <p className="text-xs text-text-muted">
            {g.cadence} · next ~ {g.nextDate} · seen {g.count}×
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums text-text">
            ${g.amount.toFixed(2)}
          </p>
          <p className="text-xs text-text-muted">{money(g.monthlyEquivalent)}/mo</p>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 bg-bg">
          <AmountHistory history={g.history} />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              Lifetime paid <b className="text-text">${g.lifetime.toFixed(2)}</b>
            </span>
            <span>
              Last charge <b className="text-text">{g.lastDate}</b>
            </span>
            {g.priceDelta && (
              <span className={g.priceDelta.direction === 'up' ? 'text-danger' : 'text-success'}>
                {g.priceDelta.direction === 'up' ? 'Up' : 'Down'} from ${g.priceDelta.from.toFixed(2)} → ${g.priceDelta.to.toFixed(2)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={g.rawLabel}
              className="flex-1 min-w-40 rounded-md border border-border bg-surface text-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
            <button
              onClick={saveNickname}
              disabled={(nickname ?? '') === (g.nickname ?? '')}
              className="rounded-md border border-border text-text hover:bg-bg text-xs font-medium px-2.5 py-1.5 disabled:opacity-40 transition"
            >
              Save name
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentStatus === 'confirmed' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                ✓ Confirmed
              </span>
            ) : (
              <button
                onClick={() => setStatus('confirmed')}
                className="rounded-md border border-success/30 text-success hover:bg-success/10 text-xs font-medium px-2.5 py-1.5 transition"
              >
                Confirm recurring
              </button>
            )}
            <button
              onClick={() => setStatus('not_recurring')}
              className="rounded-md border border-border text-text-muted hover:bg-bg text-xs font-medium px-2.5 py-1.5 transition"
            >
              Not recurring
            </button>
            {currentStatus && (
              <button
                onClick={() => onClearOverride?.(g.key)}
                className="text-xs text-text-muted hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ g }) {
  if (g.status === 'missed') {
    return (
      <span className="shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5 bg-warning/10 text-warning">
        didn’t charge
      </span>
    )
  }
  if (g.status === 'price_changed' && g.priceDelta) {
    const up = g.priceDelta.direction === 'up'
    return (
      <span
        className={`shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5 ${
          up
            ? 'bg-danger/10 text-danger'
            : 'bg-success/10 text-success'
        }`}
      >
        {up ? '↑' : '↓'} price {up ? 'up' : 'down'}
      </span>
    )
  }
  return null
}

// A lightweight spark-style bar chart of the amount series over time — enough to
// spot a step-change in price without pulling in the full charting library.
function AmountHistory({ history }) {
  if (!history || history.length === 0) return null
  const max = Math.max(...history.map((h) => Math.abs(h.amount)), 1)
  return (
    <div className="flex items-end gap-1 h-14">
      {history.map((h, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${h.date}: $${h.amount.toFixed(2)}`}>
          <div
            className="w-full rounded-sm bg-interactive/70"
            style={{ height: `${Math.max(6, (Math.abs(h.amount) / max) * 100)}%` }}
          />
          <span className="text-[9px] text-text-muted tabular-nums">{h.date.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

function money(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
}
