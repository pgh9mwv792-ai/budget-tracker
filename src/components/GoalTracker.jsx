import { useState } from 'react'
import ShareCard from './ShareCard'

export default function GoalTracker({ goals, displayName = '', onCreate, onUpdate, onDelete }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !target || Number(target) <= 0) return
    setSubmitting(true)
    try {
      await onCreate({ name: name.trim(), targetAmount: Number(target) })
      setName('')
      setTarget('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 bg-surface p-4 rounded-xl border border-border shadow-sm">
        <input
          type="text"
          placeholder="Goal name (e.g. Emergency Fund)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-border bg-surface text-text px-3 py-2.5 sm:px-2 sm:py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
        />
        <input
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          placeholder="Target amount"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full sm:w-40 rounded-md border border-border bg-surface text-text px-3 py-2.5 sm:px-2 sm:py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary text-on-primary text-sm px-4 min-h-11 sm:min-h-0 font-medium hover:bg-primary-hover transition disabled:opacity-50"
        >
          Add goal
        </button>
      </form>

      <div className="grid sm:grid-cols-2 gap-4">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} displayName={displayName} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
        {goals.length === 0 && <p className="text-sm text-text-muted">No savings goals yet.</p>}
      </div>
    </div>
  )
}

function GoalCard({ goal, displayName = '', onUpdate, onDelete }) {
  const [editingAmount, setEditingAmount] = useState(false)
  const [draft, setDraft] = useState(goal.current_amount)
  const [sharing, setSharing] = useState(false)

  const pct = Math.min(100, (Number(goal.current_amount) / Number(goal.target_amount)) * 100)
  const complete = Number(goal.current_amount) >= Number(goal.target_amount)
  const firstName = displayName.trim().split(/\s+/)[0] || ''
  const shareCard = {
    id: 'goal',
    label: 'Goal',
    eyebrow: 'Goal reached',
    stat: `$${Math.round(Number(goal.target_amount)).toLocaleString('en-US')}`,
    caption: goal.name,
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      {sharing && (
        <ShareCard cards={[shareCard]} firstName={firstName} onClose={() => setSharing(false)} />
      )}
      <div className="flex justify-between items-start">
        <h3 className="font-medium text-text">{goal.name}</h3>
        <button onClick={() => onDelete(goal.id)} className="text-danger hover:text-danger/80 text-sm">
          Delete
        </button>
      </div>

      {complete && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-success/10 border border-success/30 px-3 py-2">
          <span className="text-sm font-medium text-success">🎉 Goal reached!</span>
          <button
            onClick={() => setSharing(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-success hover:underline"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
              <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
            </svg>
            Share
          </button>
        </div>
      )}

      <div className="mt-3 h-2 rounded-full bg-border overflow-hidden">
        <div className="h-full bg-success transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2 flex items-center justify-between text-sm text-text-muted">
        {editingAmount ? (
          <div className="flex items-center gap-2">
            <span>$</span>
            <input
              type="number"
              step="0.01"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  await onUpdate(goal.id, { current_amount: Number(draft) })
                  setEditingAmount(false)
                }
                if (e.key === 'Escape') setEditingAmount(false)
              }}
              className="w-24 rounded-md border border-border bg-surface text-text px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
            <button
              onClick={async () => {
                await onUpdate(goal.id, { current_amount: Number(draft) })
                setEditingAmount(false)
              }}
              className="text-text font-medium"
            >
              Save
            </button>
          </div>
        ) : (
          <button onClick={() => setEditingAmount(true)} className="hover:text-text">
            ${Number(goal.current_amount).toFixed(2)} / ${Number(goal.target_amount).toFixed(2)}
          </button>
        )}
        <span>{pct.toFixed(0)}%</span>
      </div>
    </div>
  )
}
