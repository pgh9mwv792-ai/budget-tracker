import { useMemo, useState } from 'react'
import BottomSheet from './BottomSheet'
import WeightLogPanel from './WeightLogPanel'
import { todayISO } from '../lib/dateHelpers'
import {
  getCurrentValue,
  getProgressPct,
  getPace,
  getStatus,
  isSpendLimit,
  rollingAverage,
  formatWeight,
  parseWeightInput,
  lbToKg,
  kgToLb,
} from '../lib/goals'

const usd = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('en-US')

// The five add-goal templates (spec §4, step 1).
const TEMPLATES = [
  { id: 'save', icon: '🎯', title: 'Save an amount', desc: 'Grow a savings balance or bucket', type: 'financial', direction: 'increase', source: 'account' },
  { id: 'debt', icon: '💳', title: 'Pay off debt', desc: 'Bring a balance down to zero', type: 'financial', direction: 'decrease', source: 'account' },
  { id: 'spend', icon: '📉', title: 'Spend less on a category', desc: 'Stay under a monthly limit', type: 'financial', direction: 'decrease', source: 'budget_category' },
  { id: 'weight', icon: '⚖️', title: 'Reach a weight', desc: 'Track toward a goal weight', type: 'fitness', direction: 'auto', source: 'weight_log' },
  { id: 'custom', icon: '✳️', title: 'Custom', desc: 'Track anything by hand', type: 'financial', direction: 'increase', source: 'manual' },
]

export default function GoalsTab({
  goals = [],
  weightLogs = [],
  profile,
  accounts = [],
  transactions = [],
  categories = [],
  onCreateGoal,
  onUpdateGoal,
  onDeleteGoal,
  onQuickLog,
  onUpdateWeight,
  onDeleteWeight,
  onSaveProfile,
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showBodyStats, setShowBodyStats] = useState(true)

  const today = todayISO()
  const unit = profile?.unit_preference || 'imperial'
  const ctx = useMemo(
    () => ({ weightLogs, accounts, transactions, today }),
    [weightLogs, accounts, transactions, today]
  )

  // Only active + completed goals show in the grid; archived are hidden.
  const visibleGoals = goals.filter((g) => g.status !== 'archived')

  // Resolve each goal's live value, pace and status once, up front.
  const computed = useMemo(
    () =>
      visibleGoals.map((goal) => {
        const current = getCurrentValue(goal, ctx)
        const pace = paceForGoal(goal, current, ctx)
        const status = getStatus(goal, current, pace, { today })
        return { goal, current, pace, status, pct: getProgressPct(goal, current) }
      }),
    [visibleGoals, ctx, today]
  )

  const onPaceCount = computed.filter((c) => c.status === 'on_pace' || c.status === 'done').length
  const total = computed.length

  // The active weight goal drives the chart's projection line.
  const weightGoal = goals.find(
    (g) => g.status === 'active' && g.type === 'fitness' && g.source_ref?.kind === 'weight_log'
  )

  const needsBodyStats = (profile?.height_cm == null) && showBodyStats

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Goals</h2>
          <p className="text-sm text-text-muted">
            {total === 0 ? 'No goals yet' : `${onPaceCount} of ${total} on pace`}
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="rounded-md bg-primary text-on-primary text-sm px-4 min-h-11 sm:min-h-0 sm:py-2 font-medium hover:bg-primary-hover transition"
        >
          New goal
        </button>
      </div>

      {/* Body-stats onboarding (inline, non-blocking) */}
      {needsBodyStats && (
        <BodyStatsCard
          profile={profile}
          onDismiss={() => setShowBodyStats(false)}
          onSave={async ({ heightCm, unitPreference, weightKg }) => {
            await onSaveProfile({ heightCm, unitPreference })
            if (weightKg != null) await onQuickLog({ weightKg, loggedOn: today })
            setShowBodyStats(false)
          }}
        />
      )}

      {/* Goal cards, or the empty invitation */}
      {total === 0 ? (
        <EmptyGoals
          onPick={(templateId) => {
            setEditing({ templateId })
            setDialogOpen(true)
          }}
        />
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {computed.map((c) => (
            <GoalCard
              key={c.goal.id}
              data={c}
              unit={unit}
              categories={categories}
              onEdit={() => {
                setEditing({ goal: c.goal })
                setDialogOpen(true)
              }}
              onArchive={() => onUpdateGoal(c.goal.id, { status: 'archived' })}
              onComplete={() => onUpdateGoal(c.goal.id, { status: 'completed' })}
              onDelete={() => onDeleteGoal(c.goal.id)}
            />
          ))}
        </div>
      )}

      {/* Weight log */}
      <WeightLogPanel
        weightLogs={weightLogs}
        profile={profile}
        weightGoal={weightGoal}
        onQuickLog={onQuickLog}
        onUpdateEntry={onUpdateWeight}
        onDeleteEntry={onDeleteWeight}
      />

      <AddGoalDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
        editing={editing}
        unit={unit}
        accounts={accounts}
        categories={categories}
        weightLogs={weightLogs}
        onCreate={onCreateGoal}
        onUpdate={onUpdateGoal}
      />
    </div>
  )
}

// ------------------------------- goal card ---------------------------------
function GoalCard({ data, unit, categories, onEdit, onArchive, onComplete, onDelete }) {
  const { goal, current, pace, status, pct } = data
  const [menuOpen, setMenuOpen] = useState(false)

  const pill =
    status === 'behind'
      ? { text: 'Behind', cls: 'bg-warning/15 text-warning' }
      : status === 'done'
        ? { text: 'Done', cls: 'bg-primary-tint text-interactive' }
        : { text: 'On pace', cls: 'bg-success/15 text-success' }

  const barColor = status === 'behind' ? 'bg-warning' : status === 'done' ? 'bg-interactive' : 'bg-success'

  return (
    <div className="relative bg-surface rounded-xl border border-border shadow-sm p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0" aria-hidden>{iconFor(goal)}</span>
          <h3 className="font-medium text-text truncate">{goal.title || goal.name}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.text}</span>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Goal actions"
              className="h-7 w-7 grid place-items-center rounded-md text-text-muted hover:bg-primary-tint hover:text-text"
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-surface shadow-lg py-1 text-sm">
                  <MenuItem label="Edit" onClick={() => { setMenuOpen(false); onEdit() }} />
                  {goal.status !== 'completed' && (
                    <MenuItem label="Mark complete" onClick={() => { setMenuOpen(false); onComplete() }} />
                  )}
                  <MenuItem label="Archive" onClick={() => { setMenuOpen(false); onArchive() }} />
                  <MenuItem label="Delete" danger onClick={() => { setMenuOpen(false); onDelete() }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Big value / target */}
      <p className="mt-3 text-2xl font-semibold text-text">
        {bigValue(goal, current, unit).main}
        <span className="text-base font-normal text-text-muted"> / {bigValue(goal, current, unit).target}</span>
      </p>

      {/* Progress bar */}
      <div className="mt-3 h-2 rounded-full bg-border overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>

      {/* Footer: tracking source + pace projection */}
      <p className="mt-3 text-xs text-text-muted">{footerLine(goal, pace, unit, categories)}</p>
    </div>
  )
}

function MenuItem({ label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 hover:bg-primary-tint ${danger ? 'text-danger' : 'text-text'}`}
    >
      {label}
    </button>
  )
}

// --------------------------- body-stats onboarding -------------------------
function BodyStatsCard({ profile, onSave, onDismiss }) {
  const [unitPreference, setUnitPreference] = useState(profile?.unit_preference || 'imperial')
  const [ft, setFt] = useState('')
  const [inch, setInch] = useState('')
  const [cm, setCm] = useState('')
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)

  const metric = unitPreference === 'metric'
  const heightCm = metric
    ? (cm === '' ? null : Number(cm))
    : (ft === '' && inch === '' ? null : (Number(ft || 0) * 12 + Number(inch || 0)) * 2.54)
  const weightKg = parseWeightInput(weight, unitPreference)
  const canSave = heightCm != null

  return (
    <div className="bg-primary-tint border border-interactive/30 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text">Set up body stats</h3>
          <p className="text-xs text-text-muted mt-0.5">So weight goals track in your units. You can skip for now.</p>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-text-muted hover:text-text text-lg leading-none">✕</button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Units</span>
          <select
            value={unitPreference}
            onChange={(e) => setUnitPreference(e.target.value)}
            className="rounded-md border border-border bg-surface text-text px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
          >
            <option value="imperial">Imperial (lb, ft)</option>
            <option value="metric">Metric (kg, cm)</option>
          </select>
        </label>

        {metric ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Height (cm)</span>
            <input type="number" inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)}
              className="w-24 rounded-md border border-border bg-surface text-text px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40" />
          </label>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Height (ft)</span>
              <input type="number" inputMode="numeric" value={ft} onChange={(e) => setFt(e.target.value)}
                className="w-16 rounded-md border border-border bg-surface text-text px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">in</span>
              <input type="number" inputMode="numeric" value={inch} onChange={(e) => setInch(e.target.value)}
                className="w-16 rounded-md border border-border bg-surface text-text px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40" />
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Current weight ({metric ? 'kg' : 'lb'})</span>
          <input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)}
            className="w-28 rounded-md border border-border bg-surface text-text px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40" />
        </label>

        <button
          disabled={!canSave || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave({ heightCm, unitPreference, weightKg })
            } finally {
              setBusy(false)
            }
          }}
          className="rounded-md bg-primary text-on-primary text-sm px-4 py-2 font-medium hover:bg-primary-hover transition disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  )
}

// ------------------------------ empty state --------------------------------
function EmptyGoals({ onPick }) {
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-6">
      <h3 className="text-sm font-semibold text-text">Start your first goal</h3>
      <p className="text-sm text-text-muted mt-1">Pick a template — money or fitness, they all track the same way.</p>
      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            className="text-left rounded-lg border border-border bg-bg/50 hover:bg-primary-tint hover:border-interactive/40 transition p-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden>{t.icon}</span>
              <span className="text-sm font-medium text-text">{t.title}</span>
            </div>
            <p className="text-xs text-text-muted mt-1">{t.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------ add-goal dialog ----------------------------
function AddGoalDialog({ open, onClose, editing, unit, accounts, categories, weightLogs, onCreate, onUpdate }) {
  const isEdit = !!editing?.goal
  const presetTemplate = editing?.templateId
    ? TEMPLATES.find((t) => t.id === editing.templateId)
    : isEdit
      ? templateForGoal(editing.goal)
      : null

  const [template, setTemplate] = useState(presetTemplate)
  const [title, setTitle] = useState(editing?.goal?.title || '')
  const [target, setTarget] = useState(
    editing?.goal
      ? editing.goal.type === 'fitness'
        ? String(round1(displayWeight(editing.goal.target_value, unit)))
        : String(editing.goal.target_value ?? '')
      : ''
  )
  const [deadline, setDeadline] = useState(editing?.goal?.deadline || '')
  const [sourceId, setSourceId] = useState(editing?.goal?.source_ref?.id || '')
  const [direction, setDirection] = useState(editing?.goal?.direction || 'increase')
  const [busy, setBusy] = useState(false)

  // Reset local state each time the dialog opens for a different goal/template.
  const key = editing?.goal?.id || editing?.templateId || 'new'
  const [seenKey, setSeenKey] = useState(key)
  if (open && seenKey !== key) {
    setSeenKey(key)
    setTemplate(presetTemplate)
    setTitle(editing?.goal?.title || (presetTemplate && presetTemplate.id !== 'custom' ? presetTemplate.title : ''))
    setTarget(
      editing?.goal
        ? editing.goal.type === 'fitness'
          ? String(round1(displayWeight(editing.goal.target_value, unit)))
          : String(editing.goal.target_value ?? '')
        : ''
    )
    setDeadline(editing?.goal?.deadline || '')
    setSourceId(editing?.goal?.source_ref?.id || '')
    setDirection(editing?.goal?.direction || 'increase')
  }

  const step = template ? 2 : 1
  const expenseCategories = categories.filter((c) => c.kind === 'expense')

  const needsAccount = template?.source === 'account'
  const needsCategory = template?.source === 'budget_category'
  const isWeight = template?.source === 'weight_log'

  const currentAvgKg = rollingAverage(weightLogs, {})
  const targetNum = Number(target)
  const canSave =
    !!title.trim() &&
    target !== '' &&
    Number.isFinite(targetNum) &&
    (!needsCategory || sourceId !== '') // category is required for spend-limit

  async function handleSave() {
    setBusy(true)
    try {
      const payload = buildGoalPayload({
        template,
        title: title.trim(),
        target,
        deadline,
        sourceId,
        direction,
        unit,
        accounts,
        currentAvgKg,
      })
      if (isEdit) {
        await onUpdate(editing.goal.id, payload.update)
      } else {
        await onCreate(payload.create)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Edit goal' : 'New goal'}>
      {step === 1 ? (
        <div className="space-y-2">
          <p className="text-sm text-text-muted mb-2">What kind of goal?</p>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTemplate(t)
                if (t.id !== 'custom') setTitle(t.title)
                if (t.direction !== 'auto') setDirection(t.direction)
              }}
              className="w-full text-left rounded-lg border border-border bg-bg/50 hover:bg-primary-tint hover:border-interactive/40 transition p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>{t.icon}</span>
                <span className="text-sm font-medium text-text">{t.title}</span>
              </div>
              <p className="text-xs text-text-muted mt-1">{t.desc}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {!isEdit && (
            <button onClick={() => setTemplate(null)} className="text-xs text-interactive hover:underline">
              ← Change type
            </button>
          )}

          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Emergency fund"
              className="w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
          </Field>

          <Field label={isWeight ? `Target weight (${unit === 'metric' ? 'kg' : 'lb'})` : 'Target amount'}>
            <input
              type="number"
              step={isWeight ? '0.1' : '0.01'}
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={isWeight ? (unit === 'metric' ? '70' : '155') : '3000'}
              className="w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
          </Field>

          {needsAccount && (
            <Field label="Linked account (optional — leave blank to track by hand)">
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
              >
                <option value="">Manual (I'll update it myself)</option>
                {accounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.name || a.official_name || 'Account'} {a.current_balance != null ? `· ${usd(a.current_balance)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {needsCategory && (
            <Field label="Category">
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
              >
                <option value="">Pick a category…</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}

          {template?.source === 'manual' && (
            <Field label="Direction">
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
              >
                <option value="increase">Increase (go up to target)</option>
                <option value="decrease">Decrease (go down to target)</option>
              </select>
            </Field>
          )}

          {isWeight && currentAvgKg != null && (
            <p className="text-xs text-text-muted">
              Current 7-day average: {formatWeight(currentAvgKg, unit)}. Direction is set automatically from this vs. your target.
            </p>
          )}

          <Field label="Deadline (optional)">
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-md border border-border bg-surface text-text px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
          </Field>

          <button
            disabled={!canSave || busy}
            onClick={handleSave}
            className="w-full rounded-md bg-primary text-on-primary text-sm px-4 py-2.5 font-medium hover:bg-primary-hover transition disabled:opacity-50"
          >
            {isEdit ? 'Save changes' : 'Create goal'}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

// ------------------------------- helpers -----------------------------------
function round1(v) {
  if (v == null) return ''
  return Math.round(Number(v) * 10) / 10
}

function displayWeight(kg, unit) {
  if (kg == null) return null
  return unit === 'metric' ? Number(kg) : kgToLb(kg)
}

// Build the create/update payload for a goal from the dialog's fields, mapping
// display-unit weights back to kilograms and wiring auto-tracking source refs.
function buildGoalPayload({ template, title, target, deadline, sourceId, direction, unit, accounts, currentAvgKg }) {
  const isWeight = template.source === 'weight_log'
  const isSpend = template.source === 'budget_category'
  const isAccount = template.source === 'account'

  let targetValue = Number(target)
  let startValue = 0
  let dir = direction
  let tracking = 'manual'
  let sourceRef = null
  let type = template.type

  if (isWeight) {
    targetValue = unit === 'metric' ? Number(target) : lbToKg(Number(target))
    tracking = 'auto'
    sourceRef = { kind: 'weight_log' }
    startValue = currentAvgKg ?? targetValue
    dir = currentAvgKg != null && targetValue < currentAvgKg ? 'decrease' : 'increase'
    type = 'fitness'
  } else if (isSpend) {
    tracking = 'auto'
    sourceRef = { kind: 'budget_category', id: sourceId }
    dir = 'decrease'
    startValue = 0
  } else if (isAccount && sourceId) {
    tracking = 'auto'
    sourceRef = { kind: 'account', id: sourceId }
    const acct = accounts.find((a) => a.account_id === sourceId)
    startValue = acct?.current_balance != null ? Number(acct.current_balance) : 0
  }

  const create = {
    type,
    title,
    startValue,
    targetValue,
    direction: dir,
    deadline: deadline || null,
    tracking,
    sourceRef,
    currentValue: tracking === 'manual' ? startValue : null,
  }

  // Editing only touches the user-editable fields, never the tracking wiring.
  const update = {
    title,
    target_value: targetValue,
    deadline: deadline || null,
    direction: dir,
  }

  return { create, update }
}

function templateForGoal(goal) {
  if (goal.type === 'fitness') return TEMPLATES.find((t) => t.id === 'weight')
  if (isSpendLimit(goal)) return TEMPLATES.find((t) => t.id === 'spend')
  if (goal.source_ref?.kind === 'account') {
    return TEMPLATES.find((t) => t.id === (goal.direction === 'decrease' ? 'debt' : 'save'))
  }
  return TEMPLATES.find((t) => t.id === 'custom')
}

function iconFor(goal) {
  if (goal.type === 'fitness') return '⚖️'
  if (isSpendLimit(goal)) return '📉'
  if (goal.source_ref?.kind === 'account') return goal.direction === 'decrease' ? '💳' : '🎯'
  return goal.direction === 'decrease' ? '💳' : '🎯'
}

// The big "current / target" value line, formatted per goal type.
function bigValue(goal, current, unit) {
  if (goal.type === 'fitness') {
    const start = Number(goal.start_value)
    const target = Number(goal.target_value)
    if (goal.direction === 'increase') {
      const gain = current == null ? 0 : displayWeight(current, unit) - displayWeight(start, unit)
      const targetGain = displayWeight(target, unit) - displayWeight(start, unit)
      const u = unit === 'metric' ? 'kg' : 'lb'
      return { main: `${gain >= 0 ? '+' : ''}${round1(gain)} ${u}`, target: `${round1(targetGain)}` }
    }
    return {
      main: current == null ? '—' : formatWeight(current, unit),
      target: formatWeight(target, unit),
    }
  }
  // financial
  return { main: usd(current), target: usd(goal.target_value) }
}

// The single footer line: tracking source + a pace projection when we have one.
function footerLine(goal, pace, unit, categories) {
  const parts = []
  if (goal.tracking === 'auto') {
    if (goal.source_ref?.kind === 'account') parts.push('Auto-synced')
    else if (goal.source_ref?.kind === 'budget_category') {
      const cat = categories.find((c) => c.id === goal.source_ref.id)
      parts.push(`From ${cat?.name || 'category'}`)
    } else if (goal.source_ref?.kind === 'weight_log') parts.push('From weight log')
  } else {
    parts.push('Manual tracking')
  }

  if (pace && !pace.insufficient) {
    if (goal.type === 'fitness' && pace.ratePerWeek != null) {
      const perWeek = unit === 'metric' ? pace.ratePerWeek : kgToLb(pace.ratePerWeek)
      if (Math.abs(perWeek) >= 0.05) {
        parts.push(`~${round1(Math.abs(perWeek))} ${unit === 'metric' ? 'kg' : 'lb'}/wk`)
      }
    }
    if (pace.projectedDate) parts.push(`projected done ${shortMonthDay(pace.projectedDate)}`)
  }
  return parts.join(' · ')
}

function shortMonthDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Per-goal pace: weight goals fit their weigh-in history; spend-limits use the
// month's average daily burn; everything else has no history, so no projection.
function paceForGoal(goal, current, ctx) {
  const today = ctx.today || todayISO()
  if (goal.source_ref?.kind === 'weight_log') {
    const history = (ctx.weightLogs || []).map((l) => ({ date: l.logged_on, value: Number(l.weight_kg) }))
    return getPace(goal, history, { today })
  }
  if (isSpendLimit(goal)) {
    const dayOfMonth = Number(today.split('-')[2])
    const ratePerDay = dayOfMonth > 0 ? Number(current || 0) / dayOfMonth : null
    return {
      ratePerDay,
      ratePerWeek: ratePerDay == null ? null : ratePerDay * 7,
      projectedDate: null,
      insufficient: ratePerDay == null,
    }
  }
  return { ratePerDay: null, ratePerWeek: null, projectedDate: null, insufficient: true }
}
