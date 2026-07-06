import { useEffect, useMemo, useState } from 'react'
import SupplementScanner from './SupplementScanner'

// Rounds to one decimal for tidy macro fields.
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// Weight units offered for every USDA food (macros are per-100g). Named portions
// like "1 large" get merged in front when USDA has them for that specific food.
const WEIGHT_UNITS = [
  { label: 'g', grams: 1 },
  { label: 'oz', grams: 28.3495 },
  { label: '100 g', grams: 100 },
]

const inputCls =
  'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

// Unified, meal-scoped food search opened by any meal's + icon. Merges the
// user's library (client-side filter) with the USDA database (existing edge
// function), keeps manual entry + the supplement scanner reachable, and shows
// recent/frequent foods when the query is empty for one-tap re-logging.
export default function FoodSearchSheet({
  meal,
  foods,
  logs,
  onLog,
  onAddFood,
  onUpdateFood,
  onSearchFoods,
  onFoodDetails,
  onClose,
}) {
  // 'search' → results/recents. 'usda' → USDA amount+serving create card.
  // 'quantity' → servings prompt for a library food before it's logged.
  const [step, setStep] = useState('search')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [showManual, setShowManual] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [busy, setBusy] = useState(false)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Library foods already imported from USDA, keyed by fdc_id, so USDA results
  // that are already in the library can be deduped out.
  const libraryFdc = useMemo(() => {
    const s = new Set()
    for (const f of foods) if (f.fdc_id) s.add(String(f.fdc_id))
    return s
  }, [foods])

  // Client-side library matches for the current query.
  const libraryMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 12)
  }, [foods, query])

  // USDA results deduped against the library by fdc_id.
  const dbMatches = useMemo(
    () => results.filter((r) => !libraryFdc.has(String(r.fdcId))),
    [results, libraryFdc]
  )

  // Recent/frequent foods (empty-query state), derived from the user's logs —
  // grouped by food, ranked by how often they're logged then recency.
  const recents = useMemo(() => {
    const groups = new Map()
    for (const l of logs) {
      const key = l.food_id || `name:${l.name.toLowerCase()}`
      const g = groups.get(key)
      if (g) {
        g.count += 1
        if (l.date > g.date) {
          g.date = l.date
          g.snapshot = l
        }
      } else {
        groups.set(key, { count: 1, date: l.date, snapshot: l })
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || (a.date < b.date ? 1 : -1))
      .slice(0, 8)
      .map((g) => g.snapshot)
  }, [logs])

  // Debounced USDA search: wait 300ms after the last keystroke.
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

  // ---- quantity step (logging a library / recent food into this meal) ----
  const [qtyFood, setQtyFood] = useState(null) // { id?, name, calories, protein, carbs, fat, cost }
  const [servings, setServings] = useState('1')
  const [cost, setCost] = useState('')

  function openQuantity(food) {
    setQtyFood(food)
    setServings('1')
    setCost(food.cost != null ? String(food.cost) : '')
    setStep('quantity')
  }

  // Turn a food_logs snapshot (recent) into a loggable food object.
  function foodFromLog(l) {
    return {
      id: l.food_id || null,
      name: l.name,
      calories: Number(l.calories) || 0,
      protein: Number(l.protein) || 0,
      carbs: Number(l.carbs) || 0,
      fat: Number(l.fat) || 0,
      cost: l.cost == null ? null : Number(l.cost),
    }
  }

  async function confirmQuantity() {
    if (!qtyFood) return
    const s = Number(servings) || 1
    const enteredCost = cost === '' ? null : Number(cost)
    setBusy(true)
    try {
      await onLog({
        foodId: qtyFood.id || null,
        name: qtyFood.name,
        servings: s,
        calories: qtyFood.calories,
        protein: qtyFood.protein,
        carbs: qtyFood.carbs,
        fat: qtyFood.fat,
        cost: enteredCost,
      })
      // Keep the food's default cost in sync when it's a real library row and
      // the cost was changed here.
      const prev = qtyFood.cost == null ? null : Number(qtyFood.cost)
      if (onUpdateFood && qtyFood.id && enteredCost != null && enteredCost !== prev) {
        await onUpdateFood(qtyFood.id, { cost: enteredCost })
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // ---- USDA create step (Cronometer-style amount + serving size) ----
  const [picked, setPicked] = useState(null) // { fdcId, name, brand }
  const [base, setBase] = useState(null)
  const [portions, setPortions] = useState([])
  const [grams, setGrams] = useState(100)
  const [amount, setAmount] = useState('1')
  const [pName, setPName] = useState('')
  const [pCost, setPCost] = useState('')
  const [nutrients, setNutrients] = useState(null)
  const [loadingPortions, setLoadingPortions] = useState(false)

  const selectedPortion =
    portions.find((p) => p.grams === grams) ?? portions[0] ?? { label: '100 g', grams: 100 }
  const qty = Number(amount) || 0
  const factor = base ? (grams / 100) * qty : 0
  const liveMacros = base
    ? {
        calories: base.calories * factor,
        protein: base.protein * factor,
        carbs: base.carbs * factor,
        fat: base.fat * factor,
      }
    : null

  function amountLabel() {
    const p = selectedPortion
    const totalG = round1(grams * qty)
    if (p.label === 'g' || p.label === '100 g') return `${totalG} g`
    if (p.label === 'oz') return `${round1(qty)} oz (${totalG} g)`
    const unit = p.label.replace(/^1\s+/, '')
    return `${round1(qty)} ${unit} (${totalG} g)`
  }

  function portionOptionLabel(p) {
    if (p.label === 'g') return 'gram (g)'
    if (p.label === 'oz') return 'ounce (28 g)'
    if (p.label === '100 g') return '100 g'
    const unit = p.label.replace(/^1\s+/, '')
    return `${unit} — ${round1(p.grams)} g`
  }

  async function pickUsda(r) {
    setPicked({ fdcId: String(r.fdcId), name: r.name, brand: r.brand })
    setPName(r.brand ? `${r.name} (${r.brand})` : r.name)
    setPCost('')
    setBase({ calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat })
    setPortions([...WEIGHT_UNITS])
    setGrams(100)
    setAmount('1')
    setNutrients(null)
    setStep('usda')

    if (!onFoodDetails) return
    setLoadingPortions(true)
    try {
      const detail = await onFoodDetails(r.fdcId)
      if (detail) {
        setBase({ calories: detail.calories, protein: detail.protein, carbs: detail.carbs, fat: detail.fat })
        setNutrients(detail.nutrients ?? null)
        const named = detail.portions ?? []
        setPortions([...named, ...WEIGHT_UNITS])
        if (named.length) {
          setGrams(named[0].grams)
          setAmount('1')
        }
      }
    } catch {
      // keep the weight-unit fallback already shown
    } finally {
      setLoadingPortions(false)
    }
  }

  // Create the library row from the picked USDA food, then move to the quantity
  // prompt so it logs into this meal (existing 3.0 create flow → same prompt).
  async function createUsdaThenLog() {
    if (!liveMacros || !pName.trim() || !(qty > 0)) return
    setBusy(true)
    try {
      const created = await onAddFood({
        name: pName.trim(),
        servingDesc: amountLabel(),
        calories: Math.round(liveMacros.calories),
        protein: round1(liveMacros.protein),
        carbs: round1(liveMacros.carbs),
        fat: round1(liveMacros.fat),
        cost: pCost === '' ? null : Number(pCost),
        fdcId: picked?.fdcId || null,
        nutrients,
        source: 'usda',
      })
      openQuantity(created)
    } finally {
      setBusy(false)
    }
  }

  // Manual create adds to the library, then flows into the quantity prompt.
  async function createManualThenLog(values) {
    setBusy(true)
    try {
      const created = await onAddFood(values)
      openQuantity(created)
    } finally {
      setBusy(false)
    }
  }

  const hasNamedPortion = portions.some((p) => !['g', 'oz', '100 g'].includes(p.label))

  const title =
    step === 'usda'
      ? 'Add from USDA'
      : step === 'quantity'
        ? `Log to ${meal.label}`
        : `Add to ${meal.label}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {step === 'quantity' && qtyFood && (
            <QuantityStep
              food={qtyFood}
              meal={meal}
              servings={servings}
              setServings={setServings}
              cost={cost}
              setCost={setCost}
              busy={busy}
              onConfirm={confirmQuantity}
              onBack={() => setStep('search')}
            />
          )}

          {step === 'usda' && (
            <UsdaCreateStep
              picked={picked}
              pName={pName}
              setPName={setPName}
              amount={amount}
              setAmount={setAmount}
              grams={grams}
              setGrams={setGrams}
              portions={portions}
              portionOptionLabel={portionOptionLabel}
              loadingPortions={loadingPortions}
              hasNamedPortion={hasNamedPortion}
              liveMacros={liveMacros}
              amountLabel={amountLabel}
              pCost={pCost}
              setPCost={setPCost}
              qty={qty}
              busy={busy}
              meal={meal}
              onConfirm={createUsdaThenLog}
              onBack={() => setStep('search')}
            />
          )}

          {step === 'search' && (
            <>
              <div className="relative">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your foods and the USDA database…"
                  className={`w-full ${inputCls}`}
                />
                {searching && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                    searching…
                  </span>
                )}
              </div>

              {searchError && <p className="text-xs text-amber-600 dark:text-amber-400">{searchError}</p>}

              {!query.trim() && (
                <ResultGroup title="Recent foods">
                  {recents.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                      Nothing logged yet. Search above to add your first food.
                    </p>
                  ) : (
                    recents.map((l, i) => (
                      <ResultRow
                        key={l.food_id || `recent-${i}`}
                        onClick={() => openQuantity(foodFromLog(l))}
                        title={l.name}
                        subtitle={`${Math.round(Number(l.calories))} cal · ${round1(l.protein)}g P${
                          l.cost != null ? ` · $${Number(l.cost).toFixed(2)}` : ''
                        }`}
                      />
                    ))
                  )}
                </ResultGroup>
              )}

              {query.trim() && (
                <>
                  <ResultGroup title="My foods">
                    {libraryMatches.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                        No matches in your library.
                      </p>
                    ) : (
                      libraryMatches.map((f) => (
                        <ResultRow
                          key={f.id}
                          onClick={() => openQuantity(f)}
                          badge="My foods"
                          title={`${f.name}${f.serving_desc ? ` · ${f.serving_desc}` : ''}`}
                          subtitle={`${Math.round(Number(f.calories))} cal · ${round1(f.protein)}g P${
                            f.cost != null ? ` · $${Number(f.cost).toFixed(2)}` : ''
                          }`}
                        />
                      ))
                    )}
                  </ResultGroup>

                  <ResultGroup title="USDA database">
                    {!onSearchFoods ? (
                      <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                        Database search is unavailable.
                      </p>
                    ) : searching ? (
                      <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">searching…</p>
                    ) : dbMatches.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                        {query.trim().length < 2 ? 'Keep typing…' : 'No database matches.'}
                      </p>
                    ) : (
                      dbMatches.map((r) => (
                        <ResultRow
                          key={r.fdcId}
                          onClick={() => pickUsda(r)}
                          title={`${r.name}${r.brand ? ` · ${r.brand}` : ''}`}
                          subtitle={`per 100g: ${Math.round(r.calories)} cal · ${round1(r.protein)}g P · ${round1(
                            r.carbs
                          )}g C · ${round1(r.fat)}g F`}
                        />
                      ))
                    )}
                  </ResultGroup>
                </>
              )}

              {/* Manual create + supplement scanner stay reachable here. */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                {!showManual && !showScan && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowManual(true)}
                      className="flex-1 rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                      ＋ Create food
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowScan(true)}
                      className="flex-1 rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                      📋 Scan label
                    </button>
                  </div>
                )}

                {showManual && (
                  <ManualCreate
                    busy={busy}
                    onCancel={() => setShowManual(false)}
                    onCreate={createManualThenLog}
                  />
                )}

                {showScan && (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowScan(false)}
                        className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        Close scanner
                      </button>
                    </div>
                    <SupplementScanner onSave={onAddFood} />
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Saved supplements appear under “My foods” — search for one above to log it.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultGroup({ title, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{title}</p>
      <ul className="rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {children}
      </ul>
    </div>
  )
}

function ResultRow({ onClick, title, subtitle, badge }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
      >
        <p className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <span className="truncate">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 text-[10px] font-medium px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
      </button>
    </li>
  )
}

function QuantityStep({ food, meal, servings, setServings, cost, setCost, busy, onConfirm, onBack }) {
  const s = Number(servings) || 0
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{food.name}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {Math.round(Number(food.calories))} cal · {round1(food.protein)}g P per serving
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Servings</span>
          <input
            type="number"
            step="0.25"
            min="0.25"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Cost / serving
          </span>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="optional"
              className={`w-full pl-5 ${inputCls}`}
            />
          </div>
        </label>
      </div>

      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {Math.round(Number(food.calories) * s)} kcal
        </span>{' '}
        <span className="text-emerald-600 dark:text-emerald-400">P {round1(Number(food.protein) * s)}g</span>{' '}
        <span className="text-sky-600 dark:text-sky-400">C {round1(Number(food.carbs) * s)}g</span>{' '}
        <span className="text-fuchsia-600 dark:text-fuchsia-400">F {round1(Number(food.fat) * s)}g</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !(s > 0)}
          className="flex-1 rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm font-medium py-2 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Add to {meal.label}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
        >
          Back
        </button>
      </div>
    </div>
  )
}

function UsdaCreateStep({
  picked,
  pName,
  setPName,
  amount,
  setAmount,
  grams,
  setGrams,
  portions,
  portionOptionLabel,
  loadingPortions,
  hasNamedPortion,
  liveMacros,
  amountLabel,
  pCost,
  setPCost,
  qty,
  busy,
  meal,
  onConfirm,
  onBack,
}) {
  return (
    <div className="space-y-3">
      <input
        value={pName}
        onChange={(e) => setPName(e.target.value)}
        placeholder="Food name"
        className={`w-full font-medium ${inputCls}`}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Amount</span>
          <input
            type="number"
            step="0.25"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Serving size {loadingPortions && <span className="text-slate-400">· loading…</span>}
          </span>
          <select
            value={String(grams)}
            onChange={(e) => setGrams(Number(e.target.value))}
            className={`w-full ${inputCls}`}
          >
            {portions.map((p) => (
              <option key={`${p.label}-${p.grams}`} value={String(p.grams)}>
                {portionOptionLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loadingPortions && !hasNamedPortion && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          USDA has no preset portions for this food — log it by weight (grams or ounces).
        </p>
      )}

      {liveMacros && (
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Per {amountLabel()}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {Math.round(liveMacros.calories)} kcal
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">P {round1(liveMacros.protein)}g</span>
            <span className="text-sky-600 dark:text-sky-400">C {round1(liveMacros.carbs)}g</span>
            <span className="text-fuchsia-600 dark:text-fuchsia-400">F {round1(liveMacros.fat)}g</span>
          </div>
        </div>
      )}

      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>
          $
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={pCost}
          onChange={(e) => setPCost(e.target.value)}
          placeholder="cost per serving (optional)"
          className={`w-full pl-5 ${inputCls}`}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !pName.trim() || !(qty > 0)}
          className="flex-1 rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm font-medium py-2 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Add & log to {meal.label}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
        >
          Back
        </button>
      </div>
      {picked && <p className="sr-only">Selected {picked.name}</p>}
    </div>
  )
}

function ManualCreate({ busy, onCancel, onCreate }) {
  const empty = { name: '', servingDesc: '', calories: '', protein: '', carbs: '', fat: '', cost: '' }
  const [form, setForm] = useState(empty)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    onCreate({
      name: form.name.trim(),
      servingDesc: form.servingDesc.trim(),
      calories: Number(form.calories) || 0,
      protein: Number(form.protein) || 0,
      carbs: Number(form.carbs) || 0,
      fat: Number(form.fat) || 0,
      cost: form.cost === '' ? null : Number(form.cost),
      fdcId: null,
      source: 'manual',
    })
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Create a food</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input placeholder="Food name" value={form.name} onChange={set('name')} className={`col-span-2 ${inputCls}`} />
        <input placeholder="Serving" value={form.servingDesc} onChange={set('servingDesc')} className={`col-span-2 ${inputCls}`} />
        <input type="number" step="0.1" min="0" placeholder="Cal" value={form.calories} onChange={set('calories')} className={inputCls} />
        <input type="number" step="0.1" min="0" placeholder="Protein" value={form.protein} onChange={set('protein')} className={inputCls} />
        <input type="number" step="0.1" min="0" placeholder="Carbs" value={form.carbs} onChange={set('carbs')} className={inputCls} />
        <input type="number" step="0.1" min="0" placeholder="Fat" value={form.fat} onChange={set('fat')} className={inputCls} />
        <input type="number" step="0.01" min="0" placeholder="$ cost" value={form.cost} onChange={set('cost')} className={`col-span-2 sm:col-span-4 ${inputCls}`} />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm font-medium py-1.5 hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
      >
        Create &amp; log
      </button>
    </form>
  )
}
