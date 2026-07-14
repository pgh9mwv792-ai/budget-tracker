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
        <h2 className="text-lg font-semibold text-text">Categories</h2>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="rounded-md border border-border text-text hover:bg-bg transition text-sm px-3 py-1.5 disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset to defaults'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 bg-surface p-4 rounded-xl border border-border shadow-sm">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          type="text"
          placeholder="New category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm px-4 font-medium transition disabled:opacity-50"
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
    <div className="bg-surface rounded-xl border border-border shadow-sm">
      <h3 className="px-4 py-2 text-sm font-semibold text-text border-b border-border">{title}</h3>
      <div className="divide-y divide-border">
        {items.length === 0 && <p className="p-4 text-sm text-text-muted">None yet.</p>}
        {items.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm text-text">
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
                className="flex-1 rounded-md border border-border bg-surface text-text px-2 py-1 text-sm mr-2 focus:outline-none focus:ring-2 focus:ring-interactive/40"
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
                  className="text-text-muted hover:text-text"
                >
                  Save
                </button>
              ) : (
                <button
                  onClick={() => {
                    setEditingId(c.id)
                    setDraft(c.name)
                  }}
                  className="text-text-muted hover:text-text"
                >
                  Rename
                </button>
              )}
              <button onClick={() => onDelete(c.id)} className="text-danger hover:text-danger/80">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
