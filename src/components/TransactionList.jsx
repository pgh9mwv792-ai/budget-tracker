import { useMemo, useState } from 'react'
import TransactionForm from './TransactionForm'
import { downloadTransactionsCsv } from '../lib/csv'

export default function TransactionList({ transactions, categories, onCreate, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transactions.filter((t) => {
      if (kindFilter !== 'all' && t.kind !== kindFilter) return false
      if (categoryFilter === 'uncategorized' && t.category_id) return false
      if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && t.category_id !== categoryFilter)
        return false
      if (q) {
        const haystack = `${t.note ?? ''} ${t.category?.name ?? ''} ${t.date} ${t.amount}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [transactions, search, kindFilter, categoryFilter])

  return (
    <div className="space-y-4">
      <TransactionForm categories={categories} onSubmit={onCreate} />

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-40 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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
          onClick={() => downloadTransactionsCsv(filtered)}
          disabled={filtered.length === 0}
          title="Download the currently shown transactions as a CSV file"
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-3 py-1.5 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
        {transactions.length === 0 && <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No transactions yet.</p>}
        {transactions.length > 0 && filtered.length === 0 && (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
            No transactions match your filters.{' '}
            <button
              onClick={() => {
                setSearch('')
                setKindFilter('all')
                setCategoryFilter('all')
              }}
              className="text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Clear filters
            </button>
          </p>
        )}

        {filtered.map((t) =>
          editingId === t.id ? (
            <div key={t.id} className="p-2">
              <TransactionForm
                categories={categories}
                initial={{ ...t, category_id: t.category_id }}
                onCancel={() => setEditingId(null)}
                onSubmit={async (updates) => {
                  await onUpdate(t.id, {
                    date: updates.date,
                    amount: updates.amount,
                    kind: updates.kind,
                    category_id: updates.categoryId,
                    note: updates.note,
                  })
                  setEditingId(null)
                }}
              />
            </div>
          ) : (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
              <div className="flex items-center gap-4 min-w-0">
                <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">{t.date}</span>
                <span
                  className={`w-20 shrink-0 font-medium ${t.kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  {t.kind === 'income' ? '+' : '-'}${Number(t.amount).toFixed(2)}
                </span>
                <span className="w-40 shrink-0 truncate text-slate-700 dark:text-slate-200">
                  {t.category?.name ?? (
                    <span className="text-amber-600 dark:text-amber-400 italic">Uncategorized</span>
                  )}
                </span>
                <span className="text-slate-400 dark:text-slate-500 truncate">{t.note}</span>
                {t.source === 'plaid' && (
                  <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5 shrink-0">plaid</span>
                )}
              </div>
              <div className="flex gap-3 shrink-0">
                <button onClick={() => setEditingId(t.id)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100">
                  Edit
                </button>
                <button onClick={() => onDelete(t.id)} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
                  Delete
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
