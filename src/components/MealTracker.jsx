import { useMemo, useState } from 'react'
import { monthKey } from '../lib/dateHelpers'

const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snack' },
]

const today = () => new Date().toISOString().slice(0, 10)

// Heuristic: which of the user's expense categories look food-related, so we can
// compare logged food cost against actual food spending from transactions.
const FOOD_CATEGORY_RE = /grocer|food|dining|restaurant|meal|snack|eat|smoothie|coffee|supplement/i

function totalsFor(logs) {
  return logs.reduce(
    (acc, l) => {
      const s = Number(l.servings) || 0
      acc.calories += Number(l.calories) * s
      acc.protein += Number(l.protein) * s
      acc.carbs += Number(l.carbs) * s
      acc.fat += Number(l.fat) * s
      acc.cost += (l.cost == null ? 0 : Number(l.cost)) * s
      return acc
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, cost: 0 }
  )
}

export default function MealTracker({
  foods,
  logs,
  targets,
  transactions,
  onAddFood,
  onDeleteFood,
  onLogFood,
  onUpdateLog,
  onDeleteLog,
  onSetTargets,
}) {
  const [date, setDate] = useState(today())

  const dayLogs = useMemo(() => logs.filter((l) => l.date === date), [logs, date])
  const totals = useMemo(() => totalsFor(dayLogs), [dayLogs])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Meals</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>

      <DailySummary totals={totals} targets={targets} transactions={transactions} logs={logs} date={date} />

      {MEALS.map((m) => (
        <MealGroup
          key={m.key}
          meal={m}
          logs={dayLogs.filter((l) => l.meal === m.key)}
          foods={foods}
          onLogFood={(payload) => onLogFood({ ...payload, date, meal: m.key })}
          onUpdateLog={onUpdateLog}
          onDeleteLog={onDeleteLog}
        />
      ))}

      <FoodLibrary foods={foods} onAddFood={onAddFood} onDeleteFood={onDeleteFood} />
      <TargetsEditor targets={targets} onSetTargets={onSetTargets} />
    </div>
  )
}

function DailySummary({ totals, targets, transactions, logs, date }) {
  const currentMonth = monthKey(date)

  const loggedMonthCost = useMemo(
    () =>
      logs
        .filter((l) => monthKey(l.date) === currentMonth)
        .reduce((acc, l) => acc + (l.cost == null ? 0 : Number(l.cost)) * (Number(l.servings) || 0), 0),
    [logs, currentMonth]
  )

  const foodSpendMonth = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.kind === 'expense' &&
            monthKey(t.date) === currentMonth &&
            FOOD_CATEGORY_RE.test(t.category?.name ?? '')
        )
        .reduce((acc, t) => acc + Number(t.amount), 0),
    [transactions, currentMonth]
  )

  const costPer1000 = totals.calories > 0 && totals.cost > 0 ? (totals.cost / totals.calories) * 1000 : null
  const costPer100Protein = totals.protein > 0 && totals.cost > 0 ? (totals.cost / totals.protein) * 100 : null

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MacroStat label="Calories" value={totals.calories} target={targets?.calories} unit="" />
        <MacroStat label="Protein" value={totals.protein} target={targets?.protein} unit="g" />
        <MacroStat label="Carbs" value={totals.carbs} target={targets?.carbs} unit="g" />
        <MacroStat label="Fat" value={totals.fat} target={targets?.fat} unit="g" />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm border-t border-slate-100 dark:border-slate-800 pt-3">
        <span className="text-slate-700 dark:text-slate-200">
          Est. food cost today: <span className="font-semibold">${totals.cost.toFixed(2)}</span>
        </span>
        {costPer1000 != null && (
          <span className="text-slate-500 dark:text-slate-400">${costPer1000.toFixed(2)} / 1,000 kcal</span>
        )}
        {costPer100Protein != null && (
          <span className="text-slate-500 dark:text-slate-400">${costPer100Protein.toFixed(2)} / 100g protein</span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
        <span>
          Logged food cost this month: <span className="font-medium text-slate-700 dark:text-slate-200">${loggedMonthCost.toFixed(2)}</span>
        </span>
        <span>
          Food-category spending this month:{' '}
          <span className="font-medium text-slate-700 dark:text-slate-200">${foodSpendMonth.toFixed(2)}</span>{' '}
          (from your transactions)
        </span>
      </div>
    </div>
  )
}

function MacroStat({ label, value, target, unit }) {
  const hasTarget = target != null && Number(target) > 0
  const pct = hasTarget ? Math.min(100, (value / Number(target)) * 100) : 0
  const over = hasTarget && value > Number(target)
  const color = over ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {Math.round(value)}
        {unit}
        {hasTarget && (
          <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
            {' '}
            / {Math.round(Number(target))}
            {unit}
          </span>
        )}
      </p>
      {hasTarget && (
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function MealGroup({ meal, logs, foods, onLogFood, onUpdateLog, onDeleteLog }) {
  const [foodId, setFoodId] = useState('')
  const [servings, setServings] = useState('1')

  const groupTotals = totalsFor(logs)

  async function add() {
    const food = foods.find((f) => f.id === foodId)
    if (!food) return
    await onLogFood({
      foodId: food.id,
      name: food.name,
      servings: Number(servings) || 1,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      cost: food.cost,
    })
    setServings('1')
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{meal.label}</h3>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {Math.round(groupTotals.calories)} cal · {Math.round(groupTotals.protein)}g P
        </span>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {logs.map((l) => (
          <LogRow key={l.id} log={l} onUpdateLog={onUpdateLog} onDeleteLog={onDeleteLog} />
        ))}
        {logs.length === 0 && (
          <p className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500">Nothing logged.</p>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100 dark:border-slate-800">
        <select
          value={foodId}
          onChange={(e) => setFoodId(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="">{foods.length ? 'Add a food…' : 'Add foods in the library below first'}</option>
          {foods.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.serving_desc ? ` (${f.serving_desc})` : ''}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.25"
          min="0.25"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          title="Servings"
          className="w-16 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <button
          onClick={add}
          disabled={!foodId}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function LogRow({ log, onUpdateLog, onDeleteLog }) {
  const s = Number(log.servings) || 0
  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate text-slate-700 dark:text-slate-200">
          {log.name}
          {s !== 1 && <span className="text-slate-400 dark:text-slate-500"> ×{s}</span>}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {Math.round(Number(log.calories) * s)} cal · {Math.round(Number(log.protein) * s)}g P ·{' '}
          {Math.round(Number(log.carbs) * s)}g C · {Math.round(Number(log.fat) * s)}g F
          {log.cost != null && ` · $${(Number(log.cost) * s).toFixed(2)}`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <input
          type="number"
          step="0.25"
          min="0.25"
          defaultValue={log.servings}
          onBlur={(e) => {
            const v = Number(e.target.value)
            if (v > 0 && v !== Number(log.servings)) onUpdateLog(log.id, { servings: v })
          }}
          title="Servings"
          className="w-14 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <button
          onClick={() => onDeleteLog(log.id)}
          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function FoodLibrary({ foods, onAddFood, onDeleteFood }) {
  const empty = { name: '', servingDesc: '', calories: '', protein: '', carbs: '', fat: '', cost: '' }
  const [form, setForm] = useState(empty)
  const [submitting, setSubmitting] = useState(false)

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSubmitting(true)
    try {
      await onAddFood({
        name: form.name.trim(),
        servingDesc: form.servingDesc.trim(),
        calories: Number(form.calories) || 0,
        protein: Number(form.protein) || 0,
        carbs: Number(form.carbs) || 0,
        fat: Number(form.fat) || 0,
        cost: form.cost === '' ? null : Number(form.cost),
      })
      setForm(empty)
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <h3 className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">
        Food library
      </h3>

      <form onSubmit={submit} className="p-4 grid grid-cols-2 sm:grid-cols-8 gap-2">
        <input placeholder="Food name" value={form.name} onChange={set('name')} className={`col-span-2 sm:col-span-2 ${inputCls}`} />
        <input placeholder="Serving" value={form.servingDesc} onChange={set('servingDesc')} className={`col-span-2 sm:col-span-1 ${inputCls}`} />
        <input type="number" step="0.1" min="0" placeholder="Cal" value={form.calories} onChange={set('calories')} className={inputCls} />
        <input type="number" step="0.1" min="0" placeholder="Protein" value={form.protein} onChange={set('protein')} className={inputCls} />
        <input type="number" step="0.1" min="0" placeholder="Carbs" value={form.carbs} onChange={set('carbs')} className={inputCls} />
        <input type="number" step="0.1" min="0" placeholder="Fat" value={form.fat} onChange={set('fat')} className={inputCls} />
        <div className="flex gap-2 col-span-2 sm:col-span-1">
          <input type="number" step="0.01" min="0" placeholder="$ cost" value={form.cost} onChange={set('cost')} className={`flex-1 min-w-0 ${inputCls}`} />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="col-span-2 sm:col-span-8 rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm font-medium py-1.5 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Add to library
        </button>
      </form>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {foods.length === 0 && (
          <p className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500">
            No foods yet. Add one above (macros are per serving), then log it in a meal.
          </p>
        )}
        {foods.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-slate-700 dark:text-slate-200">
                {f.name}
                {f.serving_desc && <span className="text-slate-400 dark:text-slate-500"> · {f.serving_desc}</span>}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {Math.round(Number(f.calories))} cal · {Math.round(Number(f.protein))}g P · {Math.round(Number(f.carbs))}g C ·{' '}
                {Math.round(Number(f.fat))}g F
                {f.cost != null && ` · $${Number(f.cost).toFixed(2)}`}
              </p>
            </div>
            <button
              onClick={() => onDeleteFood(f.id)}
              className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs shrink-0 ml-3"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TargetsEditor({ targets, onSetTargets }) {
  const [form, setForm] = useState({
    calories: targets?.calories ?? '',
    protein: targets?.protein ?? '',
    carbs: targets?.carbs ?? '',
    fat: targets?.fat ?? '',
  })
  const [saved, setSaved] = useState(false)

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setSaved(false)
  }

  async function submit(e) {
    e.preventDefault()
    await onSetTargets({
      calories: Number(form.calories) || 0,
      protein: Number(form.protein) || 0,
      carbs: Number(form.carbs) || 0,
      fat: Number(form.fat) || 0,
    })
    setSaved(true)
  }

  const inputCls =
    'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <h3 className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">
        Daily targets
      </h3>
      <form onSubmit={submit} className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center">
        <input type="number" step="1" min="0" placeholder="Calories" value={form.calories} onChange={set('calories')} className={inputCls} />
        <input type="number" step="1" min="0" placeholder="Protein g" value={form.protein} onChange={set('protein')} className={inputCls} />
        <input type="number" step="1" min="0" placeholder="Carbs g" value={form.carbs} onChange={set('carbs')} className={inputCls} />
        <input type="number" step="1" min="0" placeholder="Fat g" value={form.fat} onChange={set('fat')} className={inputCls} />
        <button
          type="submit"
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm font-medium py-1.5 hover:bg-slate-800 dark:hover:bg-emerald-500 transition"
        >
          {saved ? 'Saved ✓' : 'Save targets'}
        </button>
      </form>
    </div>
  )
}
