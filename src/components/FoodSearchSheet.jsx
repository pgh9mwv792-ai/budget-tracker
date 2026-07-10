import { useEffect, useMemo, useState } from 'react'
import SupplementScanner from './SupplementScanner'
import FoodLabelScanner from './FoodLabelScanner'
import EnrichmentModal from './EnrichmentModal'
import { normalizeFoodNutrients } from '../lib/nutrients'
import { foodMatchesQuery } from '../lib/foodResolve'
import {
  familyForText,
  gradesForText,
  gradeById,
  gradeSearchTerm,
  rankResultsForGrade,
  nutrientsForGrade,
} from '../lib/gradeProfiles'

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
  // The just-saved food we're offering to auto-enrich (scanned/web only), or null.
  const [enrichTarget, setEnrichTarget] = useState(null)
  // Which label the scanner reads: 'food' (Nutrition Facts) or 'supplement'
  // (Supplement Facts). Defaults to food since this is the meal tracker.
  const [scanKind, setScanKind] = useState('food')
  const [busy, setBusy] = useState(false)
  // The quality grade chosen for what's being added (grass-fed, wild, whole…).
  // Null = no grade. Reset whenever the query moves to a different food family.
  const [activeGrade, setActiveGrade] = useState(null)

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

  // Client-side library matches for the current query — matches a food's name OR
  // any of its quick-name aliases (e.g. typing "eggs" finds a carton aliased so).
  const libraryMatches = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    return foods.filter((f) => foodMatchesQuery(f, q)).slice(0, 12)
  }, [foods, query])

  // Which grade family (eggs, beef, milk…) the current query belongs to, so we
  // can offer the quality chips. Null when the query matches no family.
  const gradeFamily = useMemo(() => familyForText(query), [query])
  const gradeOptions = useMemo(() => gradesForText(query), [query])

  // Drop the chosen grade when the query moves off its family (typing a new food
  // shouldn't silently keep an old grade). Comparing family ids keeps the chip
  // stable while the user refines within the same family.
  useEffect(() => {
    if (!activeGrade) return
    if (gradeById(activeGrade)?.family !== gradeFamily?.id) setActiveGrade(null)
  }, [gradeFamily, activeGrade])

  // USDA results deduped against the library by fdc_id, then re-ranked for a
  // chosen Tier-1 grade so the matching entry (grass-fed, wild…) floats up.
  const dbMatches = useMemo(() => {
    const deduped = results.filter((r) => !libraryFdc.has(String(r.fdcId)))
    return activeGrade ? rankResultsForGrade(deduped, activeGrade) : deduped
  }, [results, libraryFdc, activeGrade])

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
      // Store the raw per-100g USDA rows AND a canonical per-serving set. `factor`
      // (grams/100 × amount) is exactly the per-100g→serving scale, so the
      // normalized micros already reflect the portion the user is logging. The
      // two live side by side in the same jsonb; normalized rows carry an `id`.
      const rawNutrients = nutrients ?? []
      const normalized = normalizeFoodNutrients(rawNutrients, { source: 'usda', servingScale: factor })
      const servingDesc = amountLabel()
      let merged = [...rawNutrients, ...normalized]
      // A Tier-2 grade (e.g. grass-fed milk) overrides specific micros with its
      // cited values, scaled to this serving. Tier-1/3 grades leave nutrients as
      // is — nutrientsForGrade returns the same rows and we just store the grade.
      if (activeGrade) merged = nutrientsForGrade({ serving_desc: servingDesc, nutrients: merged }, activeGrade)
      const created = await onAddFood({
        name: pName.trim(),
        servingDesc,
        calories: Math.round(liveMacros.calories),
        protein: round1(liveMacros.protein),
        carbs: round1(liveMacros.carbs),
        fat: round1(liveMacros.fat),
        cost: pCost === '' ? null : Number(pCost),
        fdcId: picked?.fdcId || null,
        nutrients: merged,
        source: 'usda',
        grade: activeGrade || null,
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

  // Save wrapper handed to the scanners: after a scanned/web food lands, offer to
  // auto-fill the micronutrients it doesn't list from a generic USDA equivalent
  // (supplements are excluded — their label IS the whole profile). The user's
  // skip is remembered per food, so we don't re-prompt one they already declined.
  async function addFoodWithEnrichPrompt(values) {
    // Carry the chosen grade onto a scanned food. A Tier-2 grade also merges its
    // cited overrides into the scanned nutrients (scaled to the label serving);
    // Tier-1/3 leave them untouched and just record the grade.
    let payload = values
    if (activeGrade) {
      const graded = nutrientsForGrade(
        { serving_desc: values.servingDesc, nutrients: values.nutrients ?? [] },
        activeGrade
      )
      payload = { ...values, nutrients: graded, grade: activeGrade }
    }
    const created = await onAddFood(payload)
    if (
      created &&
      (created.source === 'label_scan' || created.source === 'web') &&
      !created.enrich_skipped &&
      onUpdateFood &&
      onSearchFoods &&
      onFoodDetails
    ) {
      setEnrichTarget(created)
    }
    return created
  }

  const hasNamedPortion = portions.some((p) => !['g', 'oz', '100 g'].includes(p.label))

  const title =
    step === 'usda'
      ? 'Add from USDA'
      : step === 'quantity'
        ? `Log to ${meal.label}`
        : `Add to ${meal.label}`

  return (
    <>
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

              {gradeFamily && gradeOptions.length > 0 && (
                <GradeChips
                  family={gradeFamily}
                  options={gradeOptions}
                  active={activeGrade}
                  onPick={setActiveGrade}
                />
              )}

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
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs font-medium">
                        <button
                          type="button"
                          onClick={() => setScanKind('food')}
                          className={`px-2.5 py-1 rounded-md transition ${
                            scanKind === 'food'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          🍎 Food label
                        </button>
                        <button
                          type="button"
                          onClick={() => setScanKind('supplement')}
                          className={`px-2.5 py-1 rounded-md transition ${
                            scanKind === 'supplement'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          💊 Supplement
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowScan(false)}
                        className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        Close scanner
                      </button>
                    </div>
                    {scanKind === 'food' ? (
                      <FoodLabelScanner onSave={addFoodWithEnrichPrompt} />
                    ) : (
                      <SupplementScanner onSave={onAddFood} />
                    )}
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Saved items appear under “My foods” — search for one above to log it.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    {enrichTarget && (
      <EnrichmentModal
        food={enrichTarget}
        searchTerm={gradeSearchTerm(enrichTarget.grade) || undefined}
        onUpdateFood={onUpdateFood}
        onSearchFoods={onSearchFoods}
        onFoodDetails={onFoodDetails}
        onClose={() => setEnrichTarget(null)}
      />
    )}
    </>
  )
}

// Quality-grade picker shown when the query matches a food family. Picking a
// Tier-1 grade re-ranks the USDA results toward the matching entry; a Tier-2
// grade merges its cited micros on save. Clicking the active chip clears it.
function GradeChips({ family, options, active, onPick }) {
  const activeTier = active ? gradeById(active)?.tier : null
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2 space-y-1.5">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {family.label} quality <span className="font-normal text-slate-400 dark:text-slate-500">(optional)</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((g) => {
          const on = g.id === active
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(on ? null : g.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium border transition ${
                on
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
              }`}
            >
              {g.label}
            </button>
          )
        })}
      </div>
      {active && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {activeTier === 1
            ? 'Showing the matching USDA entry first.'
            : activeTier === 2
              ? 'Cited nutrient values will be applied when you add this food.'
              : 'Saved as a label — no nutrition change.'}
        </p>
      )}
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
