import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, todayISO } from '../lib/dateHelpers'
import { costPerDay, costPerProtein } from '../lib/foodCost'
import { itemsFromLogs, plannedTemplatesForDate, templateTotals } from '../lib/mealTemplates'
import { MACRO_KEYS, MACRO_META, OVER_BAR, macroContributors } from '../lib/macros'
import FoodSearchSheet from './FoodSearchSheet'
import FoodImport from './FoodImport'
import MicronutrientSection from './MicronutrientSection'
import ContributorDropdown from './ContributorDropdown'
import FoodLibraryRow from './FoodLibraryRow'

const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
  { key: 'supplement', label: 'Supplements' },
]
const MEAL_KEYS = new Set(MEALS.map((m) => m.key))
const UNCATEGORIZED = { key: null, label: 'Uncategorized' }

const today = () => todayISO()

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

// Friendly label for the date-nav center button.
function dateLabel(date) {
  if (date === today()) return 'Today'
  if (date === addDays(today(), -1)) return 'Yesterday'
  if (date === addDays(today(), 1)) return 'Tomorrow'
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MealTracker({
  foods,
  logs,
  targets,
  transactions,
  mealTemplates = [],
  onSaveTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onLogTemplate,
  onAddFood,
  onUpdateFood,
  onDeleteFood,
  onLogFood,
  onUpdateLog,
  onDeleteLog,
  onImportLogs,
  onSetTargets,
  onSearchFoods,
  onFoodDetails,
  onBarcodeLookup,
}) {
  const [date, setDate] = useState(today())
  // Which meal's search sheet is open ({ key, label }), or null.
  const [sheetMeal, setSheetMeal] = useState(null)
  // Expanded/collapsed per section — session-only (component state, no storage).
  const [collapsed, setCollapsed] = useState({})
  const [editingTargets, setEditingTargets] = useState(false)

  const dayLogs = useMemo(() => logs.filter((l) => l.date === date), [logs, date])
  const totals = useMemo(() => totalsFor(dayLogs), [dayLogs])
  const foodsById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods])
  const uncategorized = useMemo(() => dayLogs.filter((l) => !MEAL_KEYS.has(l.meal)), [dayLogs])
  // Foods whose macros are the assistant's estimate of a named chain item — a
  // log referencing one shows an "est." marker so approximate numbers are clear.
  const estimateFoodIds = useMemo(
    () => new Set(foods.filter((f) => f.source === 'estimate').map((f) => f.id)),
    [foods]
  )

  // Maker for each library food, so a logged row can show the brand on its own
  // line beneath the food name (migration 0024). Looked up by the log's
  // food_id — logs themselves don't store a brand.
  const brandByFoodId = useMemo(
    () => new Map(foods.filter((f) => f.brand).map((f) => [f.id, f.brand])),
    [foods]
  )

  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))
  const sectionKey = (meal) => meal.key ?? 'uncategorized'

  // The user's daily supplement stack (foods flagged is_stack).
  const stackFoods = useMemo(() => foods.filter((f) => f.is_stack), [foods])
  const [loggingStack, setLoggingStack] = useState(false)

  // One-tap: log every stack food at one serving to the viewed day, filed under
  // the Supplements section. Single confirmation, then a batch of logs.
  async function logStack() {
    if (stackFoods.length === 0 || loggingStack) return
    const names = stackFoods.map((f) => f.name).join(', ')
    const ok = window.confirm(
      `Log your daily stack (${stackFoods.length} item${stackFoods.length === 1 ? '' : 's'}) to ${dateLabel(date)}?\n\n${names}`
    )
    if (!ok) return
    setLoggingStack(true)
    try {
      for (const f of stackFoods) {
        await onLogFood({
          date,
          meal: 'supplement',
          foodId: f.id,
          name: f.name,
          servings: 1,
          calories: Number(f.calories) || 0,
          protein: Number(f.protein) || 0,
          carbs: Number(f.carbs) || 0,
          fat: Number(f.fat) || 0,
          cost: f.cost == null ? null : Number(f.cost),
        })
      }
    } finally {
      setLoggingStack(false)
    }
  }

  // --- Meal templates ("my usual breakfast") ---------------------------------

  // Planned templates for the viewed day: scheduled on this weekday. Each is
  // annotated with whether it's already been logged today and its auto-log flag.
  const planned = useMemo(
    () => plannedTemplatesForDate(mealTemplates, logs, date),
    [mealTemplates, logs, date]
  )
  // "Skip for today" is session-only — dismissing a planned card hides it without
  // logging. Keyed by `${templateId}:${date}` so skipping doesn't leak to other days.
  const [skipped, setSkipped] = useState(() => new Set())
  const [loggingTemplateId, setLoggingTemplateId] = useState(null)

  async function logTemplate(template, { confirm = true } = {}) {
    if (loggingTemplateId) return
    const t = templateTotals(template.items || [])
    if (confirm) {
      const ok = window.confirm(
        `Log "${template.name}" (${(template.items || []).length} item${
          (template.items || []).length === 1 ? '' : 's'
        }) to ${dateLabel(date)}?\n\n${(template.items || [])
          .map((it) => `${it.name}${Number(it.servings) !== 1 ? ` ×${it.servings}` : ''}`)
          .join(', ')}\n\n${Math.round(t.calories)} cal · ${Math.round(t.protein)}g protein${
          t.cost > 0 ? ` · $${t.cost.toFixed(2)}` : ''
        }`
      )
      if (!ok) return
    }
    setLoggingTemplateId(template.id)
    try {
      await onLogTemplate(template, { date })
    } finally {
      setLoggingTemplateId(null)
    }
  }

  // Auto-log opted-in templates on their scheduled day — but only for the real
  // "today" (never when browsing past/future days) and only once (the log's
  // template_id makes `alreadyLogged` flip true, so the effect won't re-fire).
  const autoLoggingRef = useRef(new Set())
  useEffect(() => {
    if (date !== today()) return
    for (const p of planned) {
      if (!p.autoLog || p.alreadyLogged) continue
      if (autoLoggingRef.current.has(p.template.id)) continue
      autoLoggingRef.current.add(p.template.id)
      onLogTemplate(p.template, { date }).catch(() => {
        autoLoggingRef.current.delete(p.template.id)
      })
    }
  }, [planned, date, onLogTemplate])

  // Save a day's meal section (its logs) as a reusable template.
  async function saveSectionAsTemplate(mealKey, sectionLogs) {
    if (!onSaveTemplate || sectionLogs.length === 0) return
    const label = MEALS.find((m) => m.key === mealKey)?.label ?? 'meal'
    const suggested = `My ${label.toLowerCase()}`
    const name = window.prompt(`Save these ${sectionLogs.length} item(s) as a reusable meal. Name it:`, suggested)
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    await onSaveTemplate({
      name: trimmed,
      meal: mealKey ?? null,
      items: itemsFromLogs(sectionLogs),
      scheduledDays: [],
      autoLog: false,
    })
  }

  const visiblePlanned = planned.filter((p) => !p.alreadyLogged && !p.autoLog && !skipped.has(`${p.template.id}:${date}`))

  return (
    <div className="space-y-4">
      <TargetsHeader
        date={date}
        setDate={setDate}
        totals={totals}
        targets={targets}
        dayLogs={dayLogs}
        foodsById={foodsById}
        editingTargets={editingTargets}
        onToggleTargets={() => setEditingTargets((v) => !v)}
      />

      {editingTargets && (
        <TargetsEditor
          targets={targets}
          onSetTargets={async (values) => {
            await onSetTargets(values)
            setEditingTargets(false)
          }}
        />
      )}

      {stackFoods.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Daily stack</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
              {stackFoods.length} supplement{stackFoods.length === 1 ? '' : 's'} · {stackFoods.map((f) => f.name).join(', ')}
            </p>
          </div>
          <button
            onClick={logStack}
            disabled={loggingStack}
            className="shrink-0 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-60"
          >
            {loggingStack ? 'Logging…' : '💊 Log my stack'}
          </button>
        </div>
      )}

      {visiblePlanned.length > 0 && (
        <div className="space-y-2">
          {visiblePlanned.map((p) => (
            <PlannedMealCard
              key={p.template.id}
              template={p.template}
              dateLabel={dateLabel(date)}
              logging={loggingTemplateId === p.template.id}
              onConfirm={() => logTemplate(p.template, { confirm: false })}
              onSkip={() => setSkipped((s) => new Set(s).add(`${p.template.id}:${date}`))}
            />
          ))}
        </div>
      )}

      <MicronutrientSection
        logs={dayLogs}
        foods={foods}
        targets={targets}
        onSetTargets={onSetTargets}
        onUpdateFood={onUpdateFood}
        onSearchFoods={onSearchFoods}
        onFoodDetails={onFoodDetails}
      />

      <WeeklyStrip transactions={transactions} logs={logs} />

      {MEALS.map((meal) => (
        <MealSection
          key={meal.key}
          meal={meal}
          logs={dayLogs.filter((l) => l.meal === meal.key)}
          collapsed={!!collapsed[sectionKey(meal)]}
          onToggle={() => toggle(sectionKey(meal))}
          onAdd={() => setSheetMeal(meal)}
          onUpdateLog={onUpdateLog}
          onDeleteLog={onDeleteLog}
          onSaveMeal={onSaveTemplate ? (sectionLogs) => saveSectionAsTemplate(meal.key, sectionLogs) : null}
          estimateFoodIds={estimateFoodIds}
          brandByFoodId={brandByFoodId}
        />
      ))}

      {uncategorized.length > 0 && (
        <MealSection
          meal={UNCATEGORIZED}
          logs={uncategorized}
          collapsed={!!collapsed.uncategorized}
          onToggle={() => toggle('uncategorized')}
          onAdd={() => setSheetMeal(UNCATEGORIZED)}
          onUpdateLog={onUpdateLog}
          onDeleteLog={onDeleteLog}
          estimateFoodIds={estimateFoodIds}
          brandByFoodId={brandByFoodId}
        />
      )}

      {mealTemplates.length > 0 && (
        <SavedMealsManager
          templates={mealTemplates}
          logging={loggingTemplateId}
          onLog={(t) => logTemplate(t)}
          onUpdate={onUpdateTemplate}
          onDelete={onDeleteTemplate}
        />
      )}

      <LibraryManager
        foods={foods}
        onDeleteFood={onDeleteFood}
        onUpdateFood={onUpdateFood}
        onSearchFoods={onSearchFoods}
        onFoodDetails={onFoodDetails}
      />

      {onImportLogs && <FoodImport onImportLogs={onImportLogs} />}

      {sheetMeal && (
        <FoodSearchSheet
          meal={sheetMeal}
          foods={foods}
          logs={logs}
          onLog={(payload) => onLogFood({ ...payload, date, meal: sheetMeal.key })}
          onAddFood={onAddFood}
          onUpdateFood={onUpdateFood}
          onSearchFoods={onSearchFoods}
          onFoodDetails={onFoodDetails}
          onBarcodeLookup={onBarcodeLookup}
          onClose={() => setSheetMeal(null)}
        />
      )}
    </div>
  )
}

// Sticky summary for the selected day: date nav, one bar per macro (stable
// color, warning color past 100%), and the "food cost today" differentiator.
function TargetsHeader({ date, setDate, totals, targets, dayLogs, foodsById, editingTargets, onToggleTargets }) {
  const hasTargets = targets != null

  // When no targets are set there's no denominator for a true progress bar, so
  // each macro bar instead shows its share of the day's macro-derived calories
  // (protein/carbs 4 kcal/g, fat 9 kcal/g). Energy is the whole, so it fills.
  const macroCal = {
    protein: (Number(totals.protein) || 0) * 4,
    carbs: (Number(totals.carbs) || 0) * 4,
    fat: (Number(totals.fat) || 0) * 9,
  }
  const macroCalTotal = macroCal.protein + macroCal.carbs + macroCal.fat
  const splitPct = {
    calories: macroCalTotal > 0 ? 100 : 0,
    protein: macroCalTotal > 0 ? (macroCal.protein / macroCalTotal) * 100 : 0,
    carbs: macroCalTotal > 0 ? (macroCal.carbs / macroCalTotal) * 100 : 0,
    fat: macroCalTotal > 0 ? (macroCal.fat / macroCalTotal) * 100 : 0,
  }

  return (
    <div className="sticky top-14 z-10 -mx-4 px-4 py-2 bg-[#f8fafc] dark:bg-[#0b1120]">
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Meals</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDate(addDays(date, -1))}
              aria-label="Previous day"
              className="w-8 h-8 grid place-items-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              ‹
            </button>
            <button
              onClick={() => setDate(today())}
              className="min-w-[6rem] text-center text-sm font-medium text-slate-700 dark:text-slate-200 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              {dateLabel(date)}
            </button>
            <button
              onClick={() => setDate(addDays(date, 1))}
              aria-label="Next day"
              className="w-8 h-8 grid place-items-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              ›
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          {MACRO_KEYS.map((k) => (
            <MacroRow
              key={k}
              macroKey={k}
              value={totals[k]}
              target={targets?.[k]}
              fallbackPct={splitPct[k]}
              logs={dayLogs}
              foodsById={foodsById}
            />
          ))}
        </div>
        {!hasTargets && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Bars show today’s macro split. Set targets to track progress toward a goal.
          </p>
        )}

        {/* Food cost today — our differentiator, weighted like a macro row. */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Food cost today</span>
          <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
            ${totals.cost.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          {hasTargets ? (
            <button
              onClick={onToggleTargets}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {editingTargets ? 'Close' : 'Edit targets'}
            </button>
          ) : (
            <button
              onClick={onToggleTargets}
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
            >
              {editingTargets ? 'Close' : '＋ Set targets'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MacroRow({ macroKey, value, target, fallbackPct = 0, logs, foodsById }) {
  const meta = MACRO_META[macroKey]
  const [open, setOpen] = useState(false)
  const hasTarget = target != null && Number(target) > 0
  const isEnergy = macroKey === 'calories'
  // With a target the bar is true progress (consumed/target); without one it
  // falls back to the macro's share of today's calories.
  const pct = hasTarget ? (value / Number(target)) * 100 : fallbackPct
  const over = hasTarget && pct > 100

  // Per-food breakdown, only computed while the row is expanded.
  const breakdown = useMemo(
    () => (open ? macroContributors(macroKey, logs ?? [], foodsById) : null),
    [open, macroKey, logs, foodsById]
  )

  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left" aria-expanded={open}>
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span
              className={`shrink-0 text-slate-300 dark:text-slate-600 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            >
              ›
            </span>
            {meta.label}
          </span>
          <span className="text-slate-500 dark:text-slate-400 tabular-nums">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{Math.round(value)}</span>
            {hasTarget && ` / ${Math.round(Number(target))}`} {meta.unit}
            {hasTarget ? (
              <span className={`ml-1 ${over ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-slate-500'}`}>
                {Math.round(pct)}%
              </span>
            ) : (
              !isEnergy && <span className="ml-1 text-slate-400 dark:text-slate-500">{Math.round(fallbackPct)}%</span>
            )}
          </span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className={`h-full ${over ? OVER_BAR : meta.bar} transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </button>
      {open && breakdown && (
        <ContributorDropdown
          contributors={breakdown.contributors}
          unit={meta.unit}
          format={(n) => String(Math.round(Number(n) || 0))}
        />
      )}
    </div>
  )
}

function MealSection({ meal, logs, collapsed, onToggle, onAdd, onUpdateLog, onDeleteLog, onSaveMeal, estimateFoodIds, brandByFoodId }) {
  const t = totalsFor(logs)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
          aria-expanded={!collapsed}
        >
          <span
            className={`text-slate-400 dark:text-slate-500 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            aria-hidden
          >
            ›
          </span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{meal.label}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
            {logs.length > 0
              ? `${Math.round(t.calories)} cal${t.cost > 0 ? ` · $${t.cost.toFixed(2)}` : ''}`
              : 'Empty'}
          </span>
        </button>
        <button
          onClick={onAdd}
          aria-label={`Add food to ${meal.label}`}
          className="w-7 h-7 shrink-0 grid place-items-center rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-lg leading-none hover:bg-slate-800 dark:hover:bg-emerald-500 transition"
        >
          +
        </button>
      </div>

      {!collapsed && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {logs.map((l) => (
            <LogRow
              key={l.id}
              log={l}
              isEstimate={!!(l.food_id && estimateFoodIds?.has(l.food_id))}
              brand={l.food_id ? brandByFoodId?.get(l.food_id) : null}
              onUpdateLog={onUpdateLog}
              onDeleteLog={onDeleteLog}
            />
          ))}
          {logs.length === 0 && (
            <p className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500">
              Nothing logged. Tap + to add a food.
            </p>
          )}
          {onSaveMeal && logs.length > 0 && (
            <div className="px-4 py-2">
              <button
                onClick={() => onSaveMeal(logs)}
                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                ＋ Save as a reusable meal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// A "planned" card for a scheduled template on the viewed day: one tap to
// confirm-log it, or skip for today. Never logs on its own (auto-log templates
// bypass this card entirely and log silently).
function PlannedMealCard({ template, dateLabel, logging, onConfirm, onSkip }) {
  const t = templateTotals(template.items || [])
  const count = (template.items || []).length
  return (
    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
          Planned: {template.name}
        </p>
        <p className="text-xs text-emerald-700/80 dark:text-emerald-300/70 truncate">
          {count} item{count === 1 ? '' : 's'} · {Math.round(t.calories)} cal · {Math.round(t.protein)}g protein
          {t.cost > 0 ? ` · $${t.cost.toFixed(2)}` : ''} · for {dateLabel}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onSkip}
          disabled={logging}
          className="text-xs text-emerald-700/70 dark:text-emerald-300/70 hover:text-emerald-900 dark:hover:text-emerald-100 px-2 py-1.5 disabled:opacity-50"
        >
          Skip
        </button>
        <button
          onClick={onConfirm}
          disabled={logging}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 transition disabled:opacity-60"
        >
          {logging ? 'Logging…' : 'Log it'}
        </button>
      </div>
    </div>
  )
}

// Collapsed-by-default manager for saved meals: one-tap log, per-template
// weekday scheduling + auto-log opt-in, and delete.
function SavedMealsManager({ templates, logging, onLog, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className={`text-slate-400 dark:text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Saved meals</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {templates.length} {templates.length === 1 ? 'meal' : 'meals'}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {templates.map((t) => (
            <SavedMealRow
              key={t.id}
              template={t}
              logging={logging === t.id}
              onLog={() => onLog(t)}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SavedMealRow({ template, logging, onLog, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const t = templateTotals(template.items || [])
  const count = (template.items || []).length
  const days = Array.isArray(template.scheduled_days) ? template.scheduled_days : []
  const scheduleText = days.length
    ? [...days].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(' ')
    : 'Not scheduled'

  const toggleDay = (d) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]
    onUpdate(template.id, { scheduled_days: next.sort((a, b) => a - b) })
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{template.name}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
            {count} item{count === 1 ? '' : 's'} · {Math.round(t.calories)} cal · {Math.round(t.protein)}g P
            {t.cost > 0 ? ` · $${t.cost.toFixed(2)}` : ''} · {scheduleText}
            {template.auto_log && days.length > 0 ? ' · auto' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs px-1 py-1.5 sm:py-0"
          >
            {editing ? 'Done' : 'Schedule'}
          </button>
          <button
            onClick={onLog}
            disabled={logging}
            className="rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-60"
          >
            {logging ? 'Logging…' : 'Log'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
              Plan on these days
            </p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  className={`w-9 h-8 rounded-md text-xs font-medium transition ${
                    days.includes(d)
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!template.auto_log}
              disabled={days.length === 0}
              onChange={(e) => onUpdate(template.id, { auto_log: e.target.checked })}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Log automatically on planned days (no confirmation)
          </label>
          <button
            onClick={() => {
              if (window.confirm(`Delete the saved meal "${template.name}"? Meals you already logged from it stay.`)) {
                onDelete(template.id)
              }
            }}
            className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            Delete saved meal
          </button>
        </div>
      )}
    </div>
  )
}

// Small inline marker on foods whose macros are the assistant's estimate of a
// named chain item (source='estimate'), so approximate numbers read as such.
export function EstBadge() {
  return (
    <span
      title="Macros are an estimate"
      className="ml-1.5 align-middle rounded px-1 py-px text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    >
      est.
    </span>
  )
}

function LogRow({ log, isEstimate, brand, onUpdateLog, onDeleteLog }) {
  const [editing, setEditing] = useState(false)
  const s = Number(log.servings) || 0

  if (editing) {
    return (
      <LogEditor
        log={log}
        onSave={async (updates) => {
          await onUpdateLog(log.id, updates)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate text-slate-700 dark:text-slate-200">
          {log.name}
          {s !== 1 && <span className="text-slate-400 dark:text-slate-500"> ×{s}</span>}
          {isEstimate && <EstBadge />}
        </p>
        {brand && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{brand}</p>}
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {Math.round(Number(log.calories) * s)} cal · {Math.round(Number(log.protein) * s)}g P
          {log.cost != null && ` · $${(Number(log.cost) * s).toFixed(2)}`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <button
          onClick={() => setEditing(true)}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs px-1 py-1.5 sm:py-0"
        >
          Edit
        </button>
        <button
          onClick={() => onDeleteLog(log.id)}
          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs px-1 py-1.5 sm:py-0"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

// Inline editor for one logged item: change how much (servings), which meal it
// belongs to, and the per-serving macros/cost if they were logged wrong.
function LogEditor({ log, onSave, onCancel }) {
  const [servings, setServings] = useState(String(log.servings ?? 1))
  const [meal, setMeal] = useState(log.meal ?? '')
  const [calories, setCalories] = useState(String(log.calories ?? 0))
  const [protein, setProtein] = useState(String(log.protein ?? 0))
  const [carbs, setCarbs] = useState(String(log.carbs ?? 0))
  const [fat, setFat] = useState(String(log.fat ?? 0))
  const [cost, setCost] = useState(log.cost == null ? '' : String(log.cost))
  const [saving, setSaving] = useState(false)

  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const save = async () => {
    const sv = num(servings)
    if (sv <= 0) return
    setSaving(true)
    await onSave({
      servings: sv,
      meal: meal || null,
      calories: num(calories),
      protein: num(protein),
      carbs: num(carbs),
      fat: num(fat),
      cost: cost.trim() === '' ? null : num(cost),
    })
    setSaving(false)
  }

  const field = 'w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40'
  const labelCls = 'block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5'

  return (
    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
      <p className="truncate text-sm text-slate-700 dark:text-slate-200 mb-2">{log.name}</p>
      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className={labelCls}>Servings</span>
          <input type="number" step="0.25" min="0.25" value={servings} onChange={(e) => setServings(e.target.value)} className={field} />
        </label>
        <label className="col-span-2">
          <span className={labelCls}>Meal</span>
          <select value={meal} onChange={(e) => setMeal(e.target.value)} className={field}>
            <option value="">Uncategorized</option>
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Cal / serving</span>
          <input type="number" min="0" value={calories} onChange={(e) => setCalories(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelCls}>Protein g</span>
          <input type="number" min="0" value={protein} onChange={(e) => setProtein(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelCls}>Cost $</span>
          <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="—" className={field} />
        </label>
        <label>
          <span className={labelCls}>Carbs g</span>
          <input type="number" min="0" value={carbs} onChange={(e) => setCarbs(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelCls}>Fat g</span>
          <input type="number" min="0" value={fat} onChange={(e) => setFat(e.target.value)} className={field} />
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || num(servings) <= 0}
          className="text-xs rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 font-medium transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// Collapsed-by-default library manager: browse saved foods and delete them.
// Adding foods now happens in the meal search sheet; this keeps delete/browse
// reachable without cluttering the day view.
function LibraryManager({ foods, onDeleteFood, onUpdateFood, onSearchFoods, onFoodDetails }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className={`text-slate-400 dark:text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Food library</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {foods.length} {foods.length === 1 ? 'food' : 'foods'}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {foods.length === 0 && (
            <p className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500">
              No foods yet. Add one from a meal’s + button.
            </p>
          )}
          {foods.map((f) => (
            <FoodLibraryRow
              key={f.id}
              food={f}
              onDeleteFood={onDeleteFood}
              onUpdateFood={onUpdateFood}
              onSearchFoods={onSearchFoods}
              onFoodDetails={onFoodDetails}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// This-week-vs-last-week strip: food spend (from transactions), protein logged,
// and cost per 100g protein — the money+food health check in one line. Always
// relative to the real "today", not the viewed day.
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

function TargetsEditor({ targets, onSetTargets }) {
  const [form, setForm] = useState({
    calories: targets?.calories ?? '',
    protein: targets?.protein ?? '',
    carbs: targets?.carbs ?? '',
    fat: targets?.fat ?? '',
  })

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    await onSetTargets({
      calories: Number(form.calories) || 0,
      protein: Number(form.protein) || 0,
      carbs: Number(form.carbs) || 0,
      fat: Number(form.fat) || 0,
    })
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
          Save targets
        </button>
      </form>
    </div>
  )
}
