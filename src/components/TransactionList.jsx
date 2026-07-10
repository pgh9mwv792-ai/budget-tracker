import { useMemo, useState } from 'react'
import TransactionForm from './TransactionForm'
import BottomSheet from './BottomSheet'
import { downloadTransactionsCsv } from '../lib/csv'
import { cleanMerchantName, txnDescriptorText } from '../lib/receiptMatch'
import { todayISO, addDays } from '../lib/dateHelpers'

const LENSES = [
  { id: 'date', label: 'Date' },
  { id: 'category', label: 'Category' },
  { id: 'merchant', label: 'Merchant' },
]

// A day header shows "Today" / "Yesterday" / "Mon, Jul 7". Parsed part-by-part so
// a 'YYYY-MM-DD' string isn't shifted by the browser's timezone.
function formatDay(dateStr) {
  const today = todayISO()
  if (dateStr === today) return 'Today'
  if (dateStr === addDays(today, -1)) return 'Yesterday'
  const [y, m, d] = String(dateStr).split('-').map(Number)
  if (!y || !m || !d) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// The cleaned, human merchant label for a row (raw descriptor is demoted to the
// detail sheet).
function cleanName(t) {
  return cleanMerchantName(t.merchant_name || t.note || t.name || '') || 'Transaction'
}

function accountLabel(acct) {
  if (!acct) return 'Account'
  return acct.mask ? `${acct.name} ••${acct.mask}` : acct.name || 'Account'
}

function money(n) {
  return `$${Math.abs(Number(n) || 0).toFixed(2)}`
}

export default function TransactionList({
  transactions,
  categories,
  receiptsByTransaction,
  accounts = [],
  transferPairs = [],
  onCreate,
  onUpdate,
  onDelete,
  onUnpair,
}) {
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  // Group-by lens (date default). Intentionally NOT persisted across sessions.
  const [lens, setLens] = useState('date')
  const [addOpen, setAddOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [expandedPairId, setExpandedPairId] = useState(null)

  const receiptFor = (id) => receiptsByTransaction?.get?.(id) ?? null

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.account_id, a])),
    [accounts]
  )

  // Fold the two legs of each saved transfer pair into one combined feed item.
  // Legs that belong to a pair are consumed here so they don't also render as
  // standalone rows. A pair whose legs aren't both loaded is ignored.
  const items = useMemo(() => {
    const txById = new Map(transactions.map((t) => [t.id, t]))
    const consumed = new Set()
    const pairItems = []
    for (const p of transferPairs) {
      const a = txById.get(p.transaction_a)
      const b = txById.get(p.transaction_b)
      if (!a || !b) continue
      consumed.add(a.id)
      consumed.add(b.id)
      pairItems.push(makePairItem(p, a, b, accountsById))
    }
    const txItems = transactions
      .filter((t) => !consumed.has(t.id))
      .map((t) => ({ type: 'txn', id: t.id, tx: t, date: t.date }))
    return [...pairItems, ...txItems]
  }, [transactions, transferPairs, accountsById])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (it.type === 'pair') {
        if (kindFilter !== 'all' && kindFilter !== 'transfer') return false
        if (categoryFilter !== 'all') return false
        if (q) {
          const hay = `${it.label} ${it.fromLabel} ${it.toLabel} ${it.date} ${it.amount}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      }
      const t = it.tx
      if (kindFilter !== 'all' && t.kind !== kindFilter) return false
      if (categoryFilter === 'uncategorized' && t.category_id) return false
      if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && t.category_id !== categoryFilter)
        return false
      if (q) {
        const hay = `${cleanName(t)} ${txnDescriptorText(t)} ${t.category?.name ?? ''} ${t.date} ${t.amount}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, search, kindFilter, categoryFilter])

  const groups = useMemo(() => buildGroups(filtered, lens), [filtered, lens])

  // Flatten the visible items back to raw transaction rows for CSV export (both
  // legs of any visible pair are included).
  const csvRows = useMemo(() => {
    const rows = []
    for (const it of filtered) {
      if (it.type === 'pair') rows.push(it.a, it.b)
      else rows.push(it.tx)
    }
    return rows
  }, [filtered])

  const detailTx = detailId ? transactions.find((t) => t.id === detailId) : null

  const submitUpdate = async (id, updates) => {
    await onUpdate(id, {
      date: updates.date,
      amount: updates.amount,
      kind: updates.kind,
      category_id: updates.categoryId,
      note: updates.note,
    })
  }

  const clearFilters = () => {
    setSearch('')
    setKindFilter('all')
    setCategoryFilter('all')
  }

  const hasAnything = items.length > 0

  return (
    <div className="space-y-4">
      {/* Add-transaction lives behind a "+ Add" button on every width; it opens
          the bottom sheet. */}
      <button
        onClick={() => setAddOpen(true)}
        className="w-full rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium text-sm min-h-12 flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
      >
        <span className="text-lg leading-none">+</span> Add transaction
      </button>

      {/* Condensed control row: search + type + category + export. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:flex-1 sm:w-auto sm:min-w-40 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="flex-1 sm:flex-none rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfers</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="flex-1 sm:flex-none rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => downloadTransactionsCsv(csvRows)}
          disabled={csvRows.length === 0}
          title="Download the currently shown transactions as a CSV file"
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-3 py-2 sm:py-1.5 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Group-by lens toggle, above the feed. */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLens(l.id)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${
              lens === l.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {!hasAnything && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No transactions yet.</p>
        </div>
      )}
      {hasAnything && filtered.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
            No transactions match your filters.{' '}
            <button onClick={clearFilters} className="text-emerald-600 dark:text-emerald-400 hover:underline">
              Clear filters
            </button>
          </p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{g.label}</h3>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{g.right}</span>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
              {g.items.map((it) =>
                it.type === 'pair' ? (
                  <PairRow
                    key={it.id}
                    item={it}
                    expanded={expandedPairId === it.id}
                    onToggle={() => setExpandedPairId((cur) => (cur === it.id ? null : it.id))}
                    onUnpair={onUnpair}
                  />
                ) : (
                  <FeedRow
                    key={it.id}
                    t={it.tx}
                    hasReceipt={!!receiptFor(it.id)}
                    onOpen={() => setDetailId(it.id)}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add sheet — all widths. */}
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Add transaction">
        <TransactionForm
          categories={categories}
          stacked
          onCancel={() => setAddOpen(false)}
          onSubmit={async (values) => {
            await onCreate(values)
            setAddOpen(false)
          }}
        />
      </BottomSheet>

      {/* Row detail / edit sheet — all widths. Shows the raw descriptor here. */}
      <BottomSheet open={!!detailTx} onClose={() => setDetailId(null)} title="Transaction">
        {detailTx && (
          <div className="space-y-4">
            {txnDescriptorText(detailTx) && (
              <p className="text-xs text-slate-400 dark:text-slate-500 break-words">
                <span className="font-medium text-slate-500 dark:text-slate-400">Bank descriptor: </span>
                {txnDescriptorText(detailTx)}
              </p>
            )}
            <TransactionForm
              categories={categories}
              stacked
              initial={{ ...detailTx, category_id: detailTx.category_id }}
              onCancel={() => setDetailId(null)}
              onSubmit={async (updates) => {
                await submitUpdate(detailTx.id, updates)
                setDetailId(null)
              }}
            />
            {receiptFor(detailTx.id) && <ReceiptDetail receipt={receiptFor(detailTx.id)} />}
            <button
              onClick={async () => {
                await onDelete(detailTx.id)
                setDetailId(null)
              }}
              className="w-full rounded-md border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-sm font-medium min-h-11 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
            >
              Delete transaction
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

// Build a combined-pair feed item. The credit-card account (if any) is the
// destination ("to"); the payment flows into it. Otherwise the order is
// arbitrary and we render a neutral ⇄.
function makePairItem(pair, a, b, accountsById) {
  const acctA = accountsById.get(a.account_id)
  const acctB = accountsById.get(b.account_id)
  const aIsCredit = acctA?.type === 'credit'
  const bIsCredit = acctB?.type === 'credit'
  const isCardPayment = aIsCredit || bIsCredit
  // "from" pays, "to" receives (the card). If neither is a card, keep a→b.
  let from = a
  let to = b
  let fromAcct = acctA
  let toAcct = acctB
  if (aIsCredit && !bIsCredit) {
    from = b
    to = a
    fromAcct = acctB
    toAcct = acctA
  }
  const date = a.date >= b.date ? a.date : b.date
  return {
    type: 'pair',
    id: pair.id,
    pair,
    a,
    b,
    from,
    to,
    fromLabel: accountLabel(fromAcct),
    toLabel: accountLabel(toAcct),
    isCardPayment,
    label: isCardPayment ? 'Credit card payment' : 'Transfer',
    amount: Number(a.amount),
    date,
  }
}

// Group filtered items by the active lens.
//  • date: newest day first, header shows the day's net spend (transfers excluded).
//  • category / merchant: header shows the group's total and count.
function buildGroups(filtered, lens) {
  if (lens === 'date') {
    const byDay = new Map()
    for (const it of filtered) {
      const arr = byDay.get(it.date) ?? []
      arr.push(it)
      byDay.set(it.date, arr)
    }
    return [...byDay.entries()]
      .sort((x, y) => (x[0] < y[0] ? 1 : -1))
      .map(([date, its]) => {
        const net = its.reduce((s, it) => s + signedSpend(it), 0)
        return {
          key: date,
          label: formatDay(date),
          right: net === 0 ? '$0.00' : `${net > 0 ? '+' : '−'}${money(net)}`,
          items: its,
        }
      })
  }

  const keyOf =
    lens === 'category'
      ? (it) =>
          it.type === 'pair'
            ? 'Transfers'
            : it.tx.category?.name ?? 'Uncategorized'
      : (it) => (it.type === 'pair' ? it.label : cleanName(it.tx))

  const byKey = new Map()
  for (const it of filtered) {
    const k = keyOf(it)
    const arr = byKey.get(k) ?? []
    arr.push(it)
    byKey.set(k, arr)
  }
  return [...byKey.entries()]
    .map(([label, its]) => {
      const total = its.reduce((s, it) => s + Math.abs(itemAmount(it)), 0)
      return {
        key: label,
        label,
        right: `${money(total)} · ${its.length} item${its.length === 1 ? '' : 's'}`,
        items: its,
      }
    })
    .sort((x, y) => {
      const tx = x.items.reduce((s, it) => s + Math.abs(itemAmount(it)), 0)
      const ty = y.items.reduce((s, it) => s + Math.abs(itemAmount(it)), 0)
      return ty - tx
    })
}

// Signed contribution to a day's net spend: income adds, expense subtracts,
// transfers (and paired transfers) are excluded.
function signedSpend(it) {
  if (it.type === 'pair') return 0
  const t = it.tx
  if (t.kind === 'income') return Number(t.amount)
  if (t.kind === 'expense') return -Number(t.amount)
  return 0
}

function itemAmount(it) {
  return it.type === 'pair' ? it.amount : Number(it.tx.amount)
}

// A single transaction row: cleaned merchant, category chip, amount. Tapping it
// opens the detail/edit sheet. Unpaired transfer legs render muted.
function FeedRow({ t, hasReceipt, onOpen }) {
  const isTransfer = t.kind === 'transfer'
  const amountCls = isTransfer
    ? 'text-slate-500 dark:text-slate-400'
    : t.kind === 'income'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400'
  const sign = t.kind === 'income' ? '+' : t.kind === 'transfer' ? '⇄ ' : '−'
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-4 py-3 min-h-14 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
    >
      <div className="min-w-0 flex items-center gap-2">
        <span className={`text-sm truncate ${isTransfer ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
          {cleanName(t)}
        </span>
        {t.category?.name ? (
          <span className="shrink-0 text-[11px] rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {t.category.name}
          </span>
        ) : isTransfer ? null : (
          <span className="shrink-0 text-[11px] rounded-full px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
            Uncategorized
          </span>
        )}
        {hasReceipt && <span className="shrink-0 text-xs" title="Has itemized receipt">🧾</span>}
        {t.source === 'plaid' && (
          <span className="shrink-0 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5">plaid</span>
        )}
      </div>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${amountCls}`}>
        {sign}${Number(t.amount).toFixed(2)}
      </span>
    </button>
  )
}

// A combined paired-transfer row: one line for the whole move, expandable to the
// two underlying legs with an Unpair action. Muted, no category chip.
function PairRow({ item, expanded, onToggle, onUnpair }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 min-h-14 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <span aria-hidden>⇄</span>
            <span className="truncate">{item.label}</span>
            <span className={`text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
            {item.fromLabel} → {item.toLabel}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400">
          ${item.amount.toFixed(2)}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2 bg-slate-50/60 dark:bg-slate-800/30">
          {[item.from, item.to].map((leg, i) => (
            <div key={leg.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                {i === 0 ? 'From' : 'To'} · {leg.date}
              </span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">${Number(leg.amount).toFixed(2)}</span>
            </div>
          ))}
          <button
            onClick={() => onUnpair?.(item.pair.id)}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:underline"
          >
            Unpair — show as two separate transactions
          </button>
        </div>
      )}
    </div>
  )
}

// Read-only itemization shown under a matched transaction: the receipt's line
// items and, where mapped, the library food each links to.
function ReceiptDetail({ receipt }) {
  const items = receipt.items ?? []
  return (
    <div className="px-1 pb-1 pt-1">
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
        {items.length === 0 && (
          <p className="px-3 py-2 text-slate-400 dark:text-slate-500">No line items recorded.</p>
        )}
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="flex-1 min-w-0 truncate text-slate-600 dark:text-slate-300">
              {it.raw_name}
              {it.food?.name && <span className="text-emerald-600 dark:text-emerald-400"> → {it.food.name}</span>}
            </span>
            {it.quantity != null && (
              <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                {it.quantity}{it.unit ? ` ${it.unit}` : ''}
              </span>
            )}
            <span className={`shrink-0 tabular-nums ${Number(it.price) < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {it.price == null ? '—' : `$${Number(it.price).toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
