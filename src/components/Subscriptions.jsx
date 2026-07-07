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
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
      >
        <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          Recurring:{' '}
          <b className="text-slate-900 dark:text-slate-100">{money(burn.monthly)}/mo</b>
          <span className="text-slate-400 dark:text-slate-500">· {burn.count} charges</span>
        </span>
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">view all →</span>
      </button>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            Recurring &amp; subscriptions
          </div>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {money(burn.monthly)}
            <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">/ month</span>
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            about <b className="text-slate-700 dark:text-slate-200">{money(burn.annual)}</b> a year across{' '}
            {burn.count} charges
          </p>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="shrink-0 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
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
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">{title}</h4>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-100 dark:border-slate-800">
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
        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{g.label}</span>
            <StatusBadge g={g} />
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {g.cadence} · next ~ {g.nextDate} · seen {g.count}×
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            ${g.amount.toFixed(2)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{money(g.monthlyEquivalent)}/mo</p>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 bg-slate-50/60 dark:bg-slate-800/30">
          <AmountHistory history={g.history} />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Lifetime paid <b className="text-slate-700 dark:text-slate-200">${g.lifetime.toFixed(2)}</b>
            </span>
            <span>
              Last charge <b className="text-slate-700 dark:text-slate-200">{g.lastDate}</b>
            </span>
            {g.priceDelta && (
              <span className={g.priceDelta.direction === 'up' ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                {g.priceDelta.direction === 'up' ? 'Up' : 'Down'} from ${g.priceDelta.from.toFixed(2)} → ${g.priceDelta.to.toFixed(2)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={g.rawLabel}
              className="flex-1 min-w-40 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            <button
              onClick={saveNickname}
              disabled={(nickname ?? '') === (g.nickname ?? '')}
              className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium px-2.5 py-1.5 disabled:opacity-40 transition"
            >
              Save name
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentStatus === 'confirmed' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                ✓ Confirmed
              </span>
            ) : (
              <button
                onClick={() => setStatus('confirmed')}
                className="rounded-md border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-xs font-medium px-2.5 py-1.5 transition"
              >
                Confirm recurring
              </button>
            )}
            <button
              onClick={() => setStatus('not_recurring')}
              className="rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium px-2.5 py-1.5 transition"
            >
              Not recurring
            </button>
            {currentStatus && (
              <button
                onClick={() => onClearOverride?.(g.key)}
                className="text-xs text-slate-400 dark:text-slate-500 hover:underline"
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
      <span className="shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
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
            ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
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
            className="w-full rounded-sm bg-emerald-400/70 dark:bg-emerald-500/60"
            style={{ height: `${Math.max(6, (Math.abs(h.amount) / max) * 100)}%` }}
          />
          <span className="text-[9px] text-slate-400 dark:text-slate-500 tabular-nums">{h.date.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

function money(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
}
