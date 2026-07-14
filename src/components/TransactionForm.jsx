import { useState } from 'react'
import { todayISO } from '../lib/dateHelpers'

const today = () => todayISO()

export default function TransactionForm({ categories, onSubmit, initial, onCancel, stacked = false }) {
  const [date, setDate] = useState(initial?.date ?? today())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [kind, setKind] = useState(initial?.kind ?? 'expense')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [submitting, setSubmitting] = useState(false)

  const filteredCategories = categories.filter((c) => c.kind === kind)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    setSubmitting(true)
    try {
      await onSubmit({
        date,
        amount: Number(amount),
        kind,
        categoryId: categoryId || null,
        note,
      })
      if (!initial) {
        setAmount('')
        setNote('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Stacked layout: one full-width control per row with roomy (≥44px) touch
  // targets. Used inside the mobile bottom sheets. The default grid layout is
  // the compact inline desktop quick-add.
  const field =
    'w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40'

  if (stacked) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          Type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value)
              setCategoryId('')
            }}
            className={field}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          Amount
          <input
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
            <option value="">Uncategorized</option>
            {filteredCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          Note (optional)
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm min-h-11 font-medium transition disabled:opacity-50"
          >
            {initial ? 'Save' : 'Add transaction'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border text-text hover:bg-bg transition text-sm px-4 min-h-11"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-surface p-4 rounded-xl border border-border shadow-sm">
      <select
        value={kind}
        onChange={(e) => {
          setKind(e.target.value)
          setCategoryId('')
        }}
        className="col-span-1 rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
      >
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="transfer">Transfer</option>
      </select>

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
        className="col-span-1 rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
      />

      <input
        type="number"
        step="0.01"
        min="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
        className="col-span-1 rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
      />

      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="col-span-1 rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
      >
        <option value="">Uncategorized</option>
        {filteredCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="col-span-2 sm:col-span-1 rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
      />

      <div className="col-span-2 sm:col-span-1 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm py-1.5 font-medium transition disabled:opacity-50"
        >
          {initial ? 'Save' : 'Add'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-border text-text hover:bg-bg transition text-sm px-3">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
