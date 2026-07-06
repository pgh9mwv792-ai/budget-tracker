import { useEffect, useMemo, useState } from 'react'
import { monthKey, addDays } from '../lib/dateHelpers'
import { costPerDay, costPerProtein } from '../lib/foodCost'

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
  onUpdateFood,
  onDeleteFood,
  onLogFood,
  onUpdateLog,
  onDeleteLog,
  onSetTargets,
  onSearchFoods,
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

      <WeeklyStrip transactions={transactions} logs={logs} />

      <DailySummary totals={totals} targets={targets} transactions={transactions} logs={logs} date={date} />

      {MEALS.map((m) => (
        <MealGroup
          key={m.key}
          meal={m}
          logs={dayLogs.filter((l) => l.meal === m.key)}
          foods={foods}
          onLogFood={(payload) => onLogFood({ ...payload, date, meal: m.key })}
          onUpdateFood={onUpdateFood}
          onUpdateLog={onUpdateLog}
          onDeleteLog={onDeleteLog}
        />
      ))}

      <FoodLibrary foods={foods} onAddFood={onAddFood} onDeleteFood={onDeleteFood} onSearchFoods={onSearchFoods} />
      <TargetsEditor targets={targets} onSetTargets={onSetTargets} />
    </div>
  )
}

// This-week-vs-last-week strip at the top of the Meals tab: food spend (from
// transactions), protein logged, and cost per 100g protein — the money+food
// health check in one line. Uses the shared foodCost lib so the numbers match
// the dashboard. Always relative to the real "today", not the viewed day.
function WeeklyStrip({ transactions, logs }) {
  const strip = useMemo(() => {
    const t = today()
    const lastWeekAnchor = addDays(t, -7)
    const thisSpend = costPerDay(transactions, { today: t, days: 7 })
    const lastSpend = costPerDay(transactions, { today: lastWeekAnchor, days: 7 })
    const thisProtein = costPerProtein(logs, { today: t, days: 7 })
    const lastProtein = costPerProtein(logs, { today: lastWeekAnchor, days: 7 })
    return { thisSpend, lastSpend, thisProtein, lastProtein }
  }, [transactions, logs])

  const { thisSpend, lastSpend, thisProtein, lastProtein } = strip
  const hasAny =
    thisSpend.hasData || lastSpend.hasData || thisProtein.totalProtein > 0 || lastProtein.totalProtein > 0
  if (!hasAny) return null

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">This week</h3>
      <div className="grid grid-cols-3 gap-3">
        <WeekStat
          label="Food spend"
          value={thisSpend.hasData ? `$${thisSpend.total.toFixed(0)}` : '—'}
          delta={pctDelta(thisSpend.total, lastSpend.total)}
          lowerIsBetter
        />
        <WeekStat
          label="Protein logged"
          value={thisProtein.totalProtein > 0 ? `${Math.round(thisProtein.totalProtein)}g` : '—'}
          delta={pctDelta(thisProtein.totalProtein, lastProtein.totalProtein)}
        />
        <WeekStat
          label="$ / 100g protein"
          value={thisProtein.hasData ? `$${thisProtein.costPer100g.toFixed(2)}` : '—'}
          delta={pctDelta(thisProtein.costPer100g, lastProtein.costPer100g)}
          lowerIsBetter
          hint={
            thisProtein.hasData && thisProtein.coverage != null && thisProtein.coverage < 0.999
              ? `${Math.round(thisProtein.coverage * 100)}% priced`
              : null
          }
        />
      </div>
    </div>
  )
}

// Percent change from a→b, or null when there's no comparable baseline.
function pctDelta(current, previous) {
  if (!(previous > 0) || current == null) return null
  return (current - previous) / previous
}

function WeekStat({ label, value, delta, lowerIsBetter = false, hint = null }) {
  let trend = null
  if (delta != null && Math.abs(delta) >= 0.05) {
    const up = delta > 0
    const good = lowerIsBetter ? !up : up
    trend = {
      text: `${up ? '↑' : '↓'} ${Math.round(Math.abs(delta) * 100)}%`,
      cls: good ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
    }
  } else if (delta != null) {
    trend = { text: 'flat', cls: 'text-slate-400 dark:text-slate-500' }
  }
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="text-xs h-4">
        {trend ? (
          <span className={trend.cls}>
            {trend.text} <span className="text-slate-400 dark:text-slate-500">vs last week</span>
          </span>
        ) : hint ? (
          <span className="text-slate-400 dark:text-slate-500">{hint}</span>
        ) : null}
      </p>
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

function MealGroup({ meal, logs, foods, onLogFood, onUpdateFood, onUpdateLog, onDeleteLog }) {
  const [foodId, setFoodId] = useState('')
  const [servings, setServings] = useState('1')
  // Per-serving cost for this log. Pre-filled from the selected food's saved
  // default cost; editing it here also updates that default (see add()).
  const [cost, setCost] = useState('')

  const groupTotals = totalsFor(logs)

  const selectFood = (id) => {
    setFoodId(id)
    const f = foods.find((x) => x.id === id)
    setCost(f && f.cost != null ? String(f.cost) : '')
  }

  async function add() {
    const food = foods.find((f) => f.id === foodId)
    if (!food) return
    const enteredCost = cost === '' ? null : Number(cost)
    await onLogFood({
      foodId: food.id,
      name: food.name,
      servings: Number(servings) || 1,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      cost: enteredCost,
    })
    // Remember the cost as this food's new default when it changed, so next
    // time it pre-fills correctly (per-food default cost on the foods row).
    const prev = food.cost == null ? null : Number(food.cost)
    if (onUpdateFood && enteredCost != null && enteredCost !== prev) {
      await onUpdateFood(food.id, { cost: enteredCost })
    }
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
          onChange={(e) => selectFood(e.target.value)}
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
        <div className="relative w-24 shrink-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="cost"
            title="Cost per serving"
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 pl-5 pr-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
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

// Rounds to one decimal for tidy pre-filled macro fields (protein/carbs/fat).
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

function FoodLibrary({ foods, onAddFood, onDeleteFood, onSearchFoods }) {
  const empty = { name: '', servingDesc: '', calories: '', protein: '', carbs: '', fat: '', cost: '', fdcId: '' }
  const [form, setForm] = useState(empty)
  const [submitting, setSubmitting] = useState(false)

  // USDA FoodData Central search-as-you-type. Optional (only when onSearchFoods
  // is wired) — the manual form below always works as a fallback.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  // foods already imported from USDA, keyed by fdc_id, so we can flag "already
  // in your library" and avoid creating duplicates.
  const existingByFdc = useMemo(() => {
    const m = new Map()
    for (const f of foods) if (f.fdc_id) m.set(String(f.fdc_id), f)
    return m
  }, [foods])

  // Debounced search: wait 300ms after the last keystroke before hitting USDA.
  useEffect(() => {
    const q = query.trim()
    if (!onSearchFoods || q.length < 2) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }
    setSearching(true)
    setSearchError(null)
    const handle = setTimeout(async () => {
      try {
        const res = await onSearchFoods(q)
        setResults(res)
      } catch (err) {
        setSearchError(err.message || 'Search failed')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [query, onSearchFoods])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  // Picking a USDA result pre-fills the manual form (per-100g macros, serving
  // "100 g") and remembers its fdcId. If we already have this exact food, we
  // pre-fill from the saved row instead (keeping the user's cost and any edits).
  function pickResult(r) {
    const existing = existingByFdc.get(String(r.fdcId))
    if (existing) {
      setForm({
        name: existing.name,
        servingDesc: existing.serving_desc ?? '',
        calories: existing.calories == null ? '' : String(existing.calories),
        protein: existing.protein == null ? '' : String(existing.protein),
        carbs: existing.carbs == null ? '' : String(existing.carbs),
        fat: existing.fat == null ? '' : String(existing.fat),
        cost: existing.cost == null ? '' : String(existing.cost),
        fdcId: String(r.fdcId),
      })
    } else {
      setForm({
        name: r.brand ? `${r.name} (${r.brand})` : r.name,
        servingDesc: '100 g',
        calories: String(Math.round(r.calories)),
        protein: String(round1(r.protein)),
        carbs: String(round1(r.carbs)),
        fat: String(round1(r.fat)),
        cost: '', // pricing stays user-entered — USDA has none
        fdcId: String(r.fdcId),
      })
    }
    setQuery('')
    setResults([])
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    // Don't create a second copy of a USDA food that's already in the library.
    if (form.fdcId && existingByFdc.has(form.fdcId)) {
      setForm(empty)
      return
    }
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
        fdcId: form.fdcId || null,
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

      {onSearchFoods && (
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Search the USDA food database
          </label>
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. chicken breast"
              className={`w-full ${inputCls}`}
            />
            {searching && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                searching…
              </span>
            )}
          </div>

          {searchError && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{searchError}</p>
          )}

          {results.length > 0 && (
            <ul className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {results.map((r) => {
                const inLibrary = existingByFdc.has(String(r.fdcId))
                return (
                  <li key={r.fdcId}>
                    <button
                      type="button"
                      onClick={() => pickResult(r)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        {r.name}
                        {r.brand && <span className="text-slate-400 dark:text-slate-500"> · {r.brand}</span>}
                        {inLibrary && (
                          <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">in library</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        per 100g: {Math.round(r.calories)} cal · {round1(r.protein)}g P · {round1(r.carbs)}g C ·{' '}
                        {round1(r.fat)}g F
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Pick a result to fill the fields below, then add your own cost. Or just enter a food by hand.
          </p>
        </div>
      )}

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
