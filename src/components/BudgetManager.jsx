import { useMemo, useState } from 'react'
import { monthKey, todayISO } from '../lib/dateHelpers'

export default function BudgetManager({ categories, budgets, transactions, onSetBudget, onRemoveBudget }) {
  const currentMonth = monthKey(todayISO())

  // How much has been spent per expense category THIS month.
  const spentByCategory = useMemo(() => {
    const map = new Map()
    for (const t of transactions) {
      if (t.kind !== 'expense' || !t.category_id) continue
      if (monthKey(t.date) !== currentMonth) continue
      map.set(t.category_id, (map.get(t.category_id) ?? 0) + Number(t.amount))
    }
    return map
  }, [transactions, currentMonth])

  const budgetByCategory = useMemo(() => {
    const map = new Map()
    for (const b of budgets) map.set(b.category_id, Number(b.amount))
    return map
  }, [budgets])

  const expenseCategories = categories.filter((c) => c.kind === 'expense')

  const totalBudget = budgets.reduce((acc, b) => acc + Number(b.amount), 0)
  const totalSpent = expenseCategories.reduce(
    (acc, c) => (budgetByCategory.has(c.id) ? acc + (spentByCategory.get(c.id) ?? 0) : acc),
    0
  )

  if (expenseCategories.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Add some expense categories first (in the Categories tab), then set monthly budgets for them here.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {totalBudget > 0 && (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-text">
              Total budgeted (this month)
            </h3>
            <span className="text-sm text-text-muted">
              ${totalSpent.toFixed(2)} of ${totalBudget.toFixed(2)}
            </span>
          </div>
          <ProgressBar spent={totalSpent} budget={totalBudget} />
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
        {expenseCategories.map((c) => (
          <BudgetRow
            key={c.id}
            category={c}
            budget={budgetByCategory.get(c.id)}
            spent={spentByCategory.get(c.id) ?? 0}
            onSetBudget={onSetBudget}
            onRemoveBudget={onRemoveBudget}
          />
        ))}
      </div>
    </div>
  )
}

function BudgetRow({ category, budget, spent, onSetBudget, onRemoveBudget }) {
  const [draft, setDraft] = useState(budget != null ? String(budget) : '')
  const hasBudget = budget != null

  async function save() {
    const value = Number(draft)
    if (!draft || Number.isNaN(value) || value < 0) return
    await onSetBudget(category.id, value)
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-sm font-medium text-text">{category.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-sm">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
            className="flex-1 sm:flex-none sm:w-24 rounded-md border border-border bg-surface text-text px-2 py-2 sm:py-1 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
          />
          <button
            onClick={save}
            className="rounded-md bg-primary hover:bg-primary-hover text-on-primary text-xs font-medium px-3 py-2 sm:px-2.5 sm:py-1 transition"
          >
            Save
          </button>
          {hasBudget && (
            <button
              onClick={() => {
                setDraft('')
                onRemoveBudget(category.id)
              }}
              className="text-danger hover:text-danger/80 text-xs px-2 py-2 sm:py-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {hasBudget && (
        <div className="mt-2">
          <ProgressBar spent={spent} budget={budget} />
          <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
            <span>
              ${spent.toFixed(2)} spent of ${Number(budget).toFixed(2)}
            </span>
            <span className={spent > budget ? 'text-danger font-medium' : ''}>
              {spent > budget
                ? `$${(spent - budget).toFixed(2)} over`
                : `$${(budget - spent).toFixed(2)} left`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressBar({ spent, budget }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
  const over = spent > budget
  const near = !over && pct >= 80
  const color = over ? 'bg-danger' : near ? 'bg-warning' : 'bg-success'
  return (
    <div className="h-2 rounded-full bg-border overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}
