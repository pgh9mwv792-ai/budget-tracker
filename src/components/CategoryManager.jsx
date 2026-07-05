import { useState } from 'react'

export default function CategoryManager({ categories, onCreate, onUpdate, onDelete, onReset }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('expense')
  const [submitting, setSubmitting] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onCreate({ name: name.trim(), kind })
      setName('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReset() {
    const ok = window.confirm(
      'Reset categories to the defaults?\n\nThis deletes all your current categories. Any budgets and auto-categorize rules tied to them are removed, and transactions using them become uncategorized. This cannot be undone.'
    )
    if (!ok) return
    setResetting(true)
    try {
      await onReset()
    } finally {
      setResetting(false)
    }
  }

  const income = categories.filter((c) => c.kind === 'income')
  const expense = categories.filter((c) => c.kind === 'expense')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Categories</h2>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-3 py-1.5 disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset to defaults'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          type="text"
          placeholder="New category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <div className="grid sm:grid-cols-2 gap-4">
        <CategoryColumn title="Expense categories" items={expense} onUpdate={onUpdate} onDelete={onDelete} />
        <CategoryColumn title="Income categories" items={income} onUpdate={onUpdate} onDelete={onDelete} />
      </div>
    </div>
  )
}

function CategoryColumn({ title, items, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <h3 className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">{title}</h3>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.length === 0 && <p className="p-4 text-sm text-slate-500 dark:text-slate-400">None yet.</p>}
        {items.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm text-slate-700 dark:text-slate-200">
            {editingId === c.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && draft.trim()) {
                    await onUpdate(c.id, { name: draft.trim() })
                    setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
                className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-sm mr-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            ) : (
              <span>{c.name}</span>
            )}
            <div className="flex gap-3 shrink-0">
              {editingId === c.id ? (
                <button
                  onClick={async () => {
                    if (draft.trim()) await onUpdate(c.id, { name: draft.trim() })
                    setEditingId(null)
                  }}
                  className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Save
                </button>
              ) : (
                <button
                  onClick={() => {
                    setEditingId(c.id)
                    setDraft(c.name)
                  }}
                  className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Rename
                </button>
              )}
              <button onClick={() => onDelete(c.id)} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
