import { useEffect, useMemo, useState } from 'react'
import SupplementScanner from './SupplementScanner'
import FoodLabelScanner from './FoodLabelScanner'
import BarcodeScanner from './BarcodeScanner'
import EnrichmentModal from './EnrichmentModal'
import { normalizeFoodNutrients } from '../lib/nutrients'
import { pluralizeLast } from '../lib/pluralize'
import { foodMatchesQuery } from '../lib/foodResolve'
import { findFoodByUpc, plausibleMacros, normalizeUpc } from '../lib/barcode'
import {
  familyForText,
  gradesForText,
  gradeById,
  gradeSearchTerm,
  rankResultsForGrade,
  nutrientsForGrade,
  householdHintForText,
  unitNounForText,
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
  'rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40'

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
  onBarcodeLookup,
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
  // Which scanner is showing: 'food' (Nutrition Facts), 'supplement' (Supplement
  // Facts), or 'barcode' (camera UPC/EAN scan). Defaults to food.
  const [scanKind, setScanKind] = useState('food')
  const [busy, setBusy] = useState(false)
  // Barcode sub-flow: 'scan' (camera live) → 'looking' (resolving the UPC) →
  // 'miss' (no product found — offer label/manual) → 'manual' (type the number).
  const [bcPhase, setBcPhase] = useState('scan')
  const [bcError, setBcError] = useState(null)
  const [bcUpc, setBcUpc] = useState('') // the last scanned/typed code, remembered
  const [manualUpc, setManualUpc] = useState('')
  // When a scanned UPC has no product match and the user falls back to manual
  // entry, we carry the code onto the created food so a future scan finds it.
  const [manualCreateUpc, setManualCreateUpc] = useState('')
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

  // USDA results deduped against the library by fdc_id and split into the two
  // labeled groups the edge function tags each row with. "Common" (Foundation /
  // SR Legacy) renders first and is re-ranked for a chosen Tier-1 grade so the
  // matching entry (grass-fed, wild…) floats up; "Branded" always renders below
  // it so packaged products never out-rank the canonical foods.
  const dbCommon = useMemo(() => {
    const deduped = results.filter(
      (r) => r.group !== 'branded' && !libraryFdc.has(String(r.fdcId))
    )
    return activeGrade ? rankResultsForGrade(deduped, activeGrade) : deduped
  }, [results, libraryFdc, activeGrade])
  const dbBranded = useMemo(
    () => results.filter((r) => r.group === 'branded' && !libraryFdc.has(String(r.fdcId))),
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

  // ---- USDA / barcode create step (Cronometer-style amount + serving size) ----
  // The same serving-scaling UI serves both a picked USDA food and a scanned
  // barcode product; `pickedSource` says which, and `pickedMeta` carries the
  // barcode-only provenance (upc, source page, plausibility) used at save.
  const [pickedSource, setPickedSource] = useState('usda') // 'usda' | 'barcode'
  const [pickedMeta, setPickedMeta] = useState(null)
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
  // The picked food's family gives us a natural single-unit noun ("egg") so a
  // named portion reads "1 large egg", and a plain-language weight hint to show
  // when USDA lists no household portions at all.
  const unitNoun = useMemo(() => unitNounForText(picked?.name), [picked])
  const noPortionHint = useMemo(() => householdHintForText(picked?.name), [picked])
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

  // Open Food Facts is community-edited, so a scanned product's per-100g macros
  // are sanity-checked before we let the user save. An implausible set blocks
  // the save and steers them to the label scanner / manual entry instead.
  const bcPlausible =
    pickedSource === 'barcode' && base ? plausibleMacros(base) : { ok: true, reason: null }

  // "large" + noun "egg" → "large egg"; skip when the portion already names it.
  function withNoun(unit) {
    if (!unitNoun || unit.toLowerCase().includes(unitNoun)) return unit
    return `${unit} ${unitNoun}`
  }

  function amountLabel() {
    const p = selectedPortion
    const totalG = round1(grams * qty)
    if (p.label === 'g' || p.label === '100 g') return `${totalG} g`
    if (p.label === 'oz') return `${round1(qty)} oz (${totalG} g)`
    const unit = withNoun(p.label.replace(/^1\s+/, ''))
    // Only pluralize when we appended a real noun ("large eggs"), never the bare
    // portion word ("large") — pluralizing that would read "larges".
    const shown = unitNoun ? pluralizeLast(unit, qty) : unit
    return `${round1(qty)} ${shown} (${totalG} g)`
  }

  function portionOptionLabel(p) {
    if (p.label === 'g') return 'gram (g)'
    if (p.label === 'oz') return 'ounce (28 g)'
    if (p.label === '100 g') return '100 g'
    const unit = withNoun(p.label.replace(/^1\s+/, ''))
    return `${unit} — ${round1(p.grams)} g`
  }

  async function pickUsda(r) {
    setPickedSource('usda')
    setPickedMeta(null)
    setPicked({ fdcId: String(r.fdcId), name: r.name, brand: r.brand })
    setPName(r.brand ? `${r.name} (${r.brand})` : r.name)
    setPCost('')
    setBase({ calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat })
    setPortions([...WEIGHT_UNITS])
    setGrams(100)
    setAmount('1')
    // Seed the micro profile from the SEARCH result. USDA's detail endpoint 404s
    // for some Foundation foods (e.g. whole egg) even though search carries all
    // ~95 nutrients — so search is the reliable source and the detail fetch below
    // only upgrades portions and overrides micros when it actually returns some.
    const searchNutrients = Array.isArray(r.nutrients) && r.nutrients.length ? r.nutrients : null
    setNutrients(searchNutrients)
    setStep('usda')

    if (!onFoodDetails) return
    setLoadingPortions(true)
    try {
      const detail = await onFoodDetails(r.fdcId)
      if (detail) {
        setBase({ calories: detail.calories, protein: detail.protein, carbs: detail.carbs, fat: detail.fat })
        // Only let detail replace the search micros if it actually returned some;
        // a 404/empty detail must not wipe the profile search already gave us.
        if (Array.isArray(detail.nutrients) && detail.nutrients.length) {
          setNutrients(detail.nutrients)
        }
        const named = detail.portions ?? []
        setPortions([...named, ...WEIGHT_UNITS])
        if (named.length) {
          setGrams(named[0].grams)
          setAmount('1')
        }
      }
    } catch {
      // keep the weight-unit fallback and the search-seeded micros already shown
    } finally {
      setLoadingPortions(false)
    }
  }

  // A scanned barcode arrived. Dedupe against the library first (a re-scan should
  // re-log the saved food, never create a second row); otherwise resolve the UPC
  // via Open Food Facts / USDA and open the verify-before-save card on a hit, or
  // the graceful miss screen (offer label scan / manual) on a miss.
  async function handleBarcode(upc) {
    setBcError(null)
    setBcUpc(upc)
    const existing = findFoodByUpc(foods, upc)
    if (existing) {
      openQuantity(existing)
      return
    }
    if (!onBarcodeLookup) {
      setBcPhase('miss')
      return
    }
    setBcPhase('looking')
    try {
      const res = await onBarcodeLookup(upc)
      if (res?.found && res.product) {
        pickBarcode(res.source, res.product)
      } else {
        setBcPhase('miss')
      }
    } catch (err) {
      setBcError(err.message || 'Lookup failed')
      setBcPhase('miss')
    }
  }

  // Load a resolved barcode product into the shared serving-scaling create step.
  // Macros come per 100 g; the serving picker defaults to the package serving
  // (from the source) so one "serving" logs the printed amount.
  function pickBarcode(source, product) {
    const grams = Number(product.servingGrams) > 0 ? Number(product.servingGrams) : 100
    setPickedSource('barcode')
    setPickedMeta({
      upc: product.upc || bcUpc,
      sourceUrl: product.sourceUrl || null,
      dataSource: source, // 'off' | 'usda' — for the provenance line
    })
    setPicked({ fdcId: product.fdcId || null, name: product.name, brand: product.brand || null })
    setPName(product.name)
    setPCost('')
    setBase({ calories: product.calories, protein: product.protein, carbs: product.carbs, fat: product.fat })
    setNutrients(product.nutrients ?? [])
    const label = product.servingSize?.trim() || '1 serving'
    setPortions([{ label, grams }, ...WEIGHT_UNITS])
    setGrams(grams)
    setAmount('1')
    // Reset the scanner UI so re-opening the tab starts fresh.
    setShowScan(false)
    setScanKind('food')
    setBcPhase('scan')
    setStep('usda')
  }

  // Create the library row from the picked USDA food, then move to the quantity
  // prompt so it logs into this meal (existing 3.0 create flow → same prompt).
  async function createUsdaThenLog() {
    if (!liveMacros || !pName.trim() || !(qty > 0)) return
    setBusy(true)
    try {
      const isBarcode = pickedSource === 'barcode'
      // Store the raw per-100g USDA rows AND a canonical per-serving set. `factor`
      // (grams/100 × amount) is exactly the per-100g→serving scale, so the
      // normalized micros already reflect the portion the user is logging. The
      // two live side by side in the same jsonb; normalized rows carry an `id`.
      // Both USDA and barcode products carry per-100g rows; `factor` scales them
      // to the logged serving. OFF rows are name-only and USDA rows carry a
      // number — normalizeNutrient falls back from number to alias, so a single
      // 'usda' pass normalizes either source correctly.
      // `nutrients` is seeded from the search result in pickUsda and only replaced
      // by the detail fetch when detail actually returns rows — so it stays
      // populated even when USDA's detail endpoint 404s. No refetch needed here.
      const rawNutrients = nutrients ?? []
      const normalized = normalizeFoodNutrients(rawNutrients, { source: 'usda', servingScale: factor })
      const servingDesc = amountLabel()
      let merged = [...rawNutrients, ...normalized]
      // Grades are chosen on the search step (USDA path only); a scanned barcode
      // never carries one, so only apply for USDA.
      if (!isBarcode && activeGrade) {
        merged = nutrientsForGrade({ serving_desc: servingDesc, nutrients: merged }, activeGrade)
      }
      const created = await onAddFood({
        name: pName.trim(),
        // A scanned product keeps its brand in the dedicated column; the USDA
        // path folds it into the editable name (unchanged behavior).
        ...(isBarcode ? { brand: picked?.brand || null } : {}),
        servingDesc,
        calories: Math.round(liveMacros.calories),
        protein: round1(liveMacros.protein),
        carbs: round1(liveMacros.carbs),
        fat: round1(liveMacros.fat),
        cost: pCost === '' ? null : Number(pCost),
        fdcId: picked?.fdcId || null,
        nutrients: merged,
        source: isBarcode ? 'barcode' : 'usda',
        grade: isBarcode ? null : activeGrade || null,
        ...(isBarcode ? { upc: pickedMeta?.upc || null, sourceRef: pickedMeta?.sourceUrl || null } : {}),
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
      ? pickedSource === 'barcode'
        ? 'Check the scanned product'
        : 'Add from USDA'
      : step === 'quantity'
        ? `Log to ${meal.label}`
        : `Add to ${meal.label}`

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-nav/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-surface border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-md text-text-muted hover:text-text hover:bg-bg transition"
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
              noPortionHint={noPortionHint}
              liveMacros={liveMacros}
              amountLabel={amountLabel}
              pCost={pCost}
              setPCost={setPCost}
              qty={qty}
              busy={busy}
              meal={meal}
              barcode={pickedSource === 'barcode' ? { meta: pickedMeta, brand: picked?.brand, plausible: bcPlausible } : null}
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
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                    searching…
                  </span>
                )}
              </div>

              {searchError && <p className="text-xs text-warning">{searchError}</p>}

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
                    <p className="px-3 py-2 text-xs text-text-muted">
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
                      <p className="px-3 py-2 text-xs text-text-muted">
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

                  <ResultGroup title="Common foods">
                    {!onSearchFoods ? (
                      <p className="px-3 py-2 text-xs text-text-muted">
                        Database search is unavailable.
                      </p>
                    ) : searching ? (
                      <p className="px-3 py-2 text-xs text-text-muted">searching…</p>
                    ) : dbCommon.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-text-muted">
                        {query.trim().length < 2 ? 'Keep typing…' : 'No common-food matches.'}
                      </p>
                    ) : (
                      dbCommon.map((r) => (
                        <ResultRow
                          key={r.fdcId}
                          onClick={() => pickUsda(r)}
                          title={r.name}
                          subtitle={`per 100g: ${Math.round(r.calories)} cal · ${round1(r.protein)}g P · ${round1(
                            r.carbs
                          )}g C · ${round1(r.fat)}g F`}
                        />
                      ))
                    )}
                  </ResultGroup>

                  {onSearchFoods && !searching && dbBranded.length > 0 && (
                    <ResultGroup title="Branded">
                      {dbBranded.map((r) => (
                        <ResultRow
                          key={r.fdcId}
                          onClick={() => pickUsda(r)}
                          title={`${r.name}${r.brand ? ` · ${r.brand}` : ''}`}
                          subtitle={`per 100g: ${Math.round(r.calories)} cal · ${round1(r.protein)}g P · ${round1(
                            r.carbs
                          )}g C · ${round1(r.fat)}g F`}
                        />
                      ))}
                    </ResultGroup>
                  )}
                </>
              )}

              {/* Manual create + supplement scanner stay reachable here. */}
              <div className="border-t border-border pt-3 space-y-2">
                {!showManual && !showScan && (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => { setManualCreateUpc(''); setShowManual(true) }}
                      className="rounded-md border border-dashed border-border text-text-muted text-sm font-medium py-2 hover:bg-bg transition"
                    >
                      ＋ Create
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScanKind('food'); setShowScan(true) }}
                      className="rounded-md border border-dashed border-border text-text-muted text-sm font-medium py-2 hover:bg-bg transition"
                    >
                      📋 Label
                    </button>
                    <button
                      type="button"
                      onClick={() => { setBcPhase('scan'); setBcError(null); setScanKind('barcode'); setShowScan(true) }}
                      className="rounded-md border border-dashed border-border text-text-muted text-sm font-medium py-2 hover:bg-bg transition"
                    >
                      📷 Barcode
                    </button>
                  </div>
                )}

                {showManual && (
                  <ManualCreate
                    busy={busy}
                    defaultUpc={manualCreateUpc}
                    onCancel={() => setShowManual(false)}
                    onCreate={createManualThenLog}
                  />
                )}

                {showScan && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
                        <button
                          type="button"
                          onClick={() => setScanKind('food')}
                          className={`px-2.5 py-1 rounded-md transition ${
                            scanKind === 'food'
                              ? 'bg-primary text-on-primary'
                              : 'text-text-muted hover:bg-bg'
                          }`}
                        >
                          🍎 Food label
                        </button>
                        <button
                          type="button"
                          onClick={() => setScanKind('supplement')}
                          className={`px-2.5 py-1 rounded-md transition ${
                            scanKind === 'supplement'
                              ? 'bg-primary text-on-primary'
                              : 'text-text-muted hover:bg-bg'
                          }`}
                        >
                          💊 Supplement
                        </button>
                        <button
                          type="button"
                          onClick={() => { setBcPhase('scan'); setBcError(null); setScanKind('barcode') }}
                          className={`px-2.5 py-1 rounded-md transition ${
                            scanKind === 'barcode'
                              ? 'bg-primary text-on-primary'
                              : 'text-text-muted hover:bg-bg'
                          }`}
                        >
                          📷 Barcode
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowScan(false)}
                        className="text-xs text-text-muted hover:text-text"
                      >
                        Close scanner
                      </button>
                    </div>
                    {scanKind === 'food' && <FoodLabelScanner onSave={addFoodWithEnrichPrompt} />}
                    {scanKind === 'supplement' && <SupplementScanner onSave={onAddFood} />}
                    {scanKind === 'barcode' && (
                      <BarcodeFlow
                        phase={bcPhase}
                        error={bcError}
                        upc={bcUpc}
                        manualUpc={manualUpc}
                        setManualUpc={setManualUpc}
                        onDetected={handleBarcode}
                        onManual={() => setBcPhase('manual')}
                        onRescan={() => { setBcPhase('scan'); setBcError(null) }}
                        onScanLabel={() => setScanKind('food')}
                        onManualCreate={() => { setManualCreateUpc(bcUpc); setShowScan(false); setShowManual(true) }}
                      />
                    )}
                    {scanKind !== 'barcode' && (
                      <p className="text-xs text-text-muted">
                        Saved items appear under “My foods” — search for one above to log it.
                      </p>
                    )}
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
    <div className="rounded-lg border border-border bg-bg px-3 py-2 space-y-1.5">
      <p className="text-xs font-medium text-text-muted">
        {family.label} quality <span className="font-normal text-text-muted">(optional)</span>
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
                  ? 'bg-primary border-primary text-on-primary'
                  : 'border-border text-text-muted hover:bg-surface'
              }`}
            >
              {g.label}
            </button>
          )
        })}
      </div>
      {active && (
        <p className="text-[11px] text-text-muted">
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

// The barcode sub-flow inside the scanner panel: live camera scan → looking up →
// (miss: offer label/manual) with a type-the-number fallback throughout.
function BarcodeFlow({
  phase,
  error,
  upc,
  manualUpc,
  setManualUpc,
  onDetected,
  onManual,
  onRescan,
  onScanLabel,
  onManualCreate,
}) {
  if (phase === 'looking') {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-text-muted">Looking up barcode…</p>
        {upc && <p className="mt-1 text-xs tabular-nums text-text-muted">#{upc}</p>}
      </div>
    )
  }

  if (phase === 'manual') {
    const submit = (e) => {
      e.preventDefault()
      const code = normalizeUpc(manualUpc)
      if (code) onDetected(code)
    }
    const valid = !!normalizeUpc(manualUpc)
    return (
      <form onSubmit={submit} className="space-y-2">
        <p className="text-sm text-text-muted">Type the barcode number (the digits under the bars).</p>
        <input
          autoFocus
          inputMode="numeric"
          value={manualUpc}
          onChange={(e) => setManualUpc(e.target.value)}
          placeholder="e.g. 016000275287"
          className={`w-full ${inputCls}`}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!valid}
            className="flex-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium py-2 transition disabled:opacity-50"
          >
            Look it up
          </button>
          <button
            type="button"
            onClick={onRescan}
            className="rounded-md border border-border text-text-muted text-sm font-medium px-4 py-2 hover:bg-bg transition"
          >
            Use camera
          </button>
        </div>
        {!valid && manualUpc.trim() !== '' && (
          <p className="text-xs text-warning">That isn’t a valid 8–14 digit barcode.</p>
        )}
      </form>
    )
  }

  if (phase === 'miss') {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
          <p className="text-sm font-medium text-warning">
            No product found{upc ? <span className="tabular-nums"> for #{upc}</span> : ''}.
          </p>
          <p className="text-[11px] text-warning/90">
            {error || 'Neither Open Food Facts nor USDA had this barcode. Add it another way — we’ll remember the number.'}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onScanLabel}
            className="rounded-md border border-border text-text-muted text-sm font-medium py-2 hover:bg-bg transition"
          >
            📋 Scan label
          </button>
          <button
            type="button"
            onClick={onManualCreate}
            className="rounded-md border border-border text-text-muted text-sm font-medium py-2 hover:bg-bg transition"
          >
            ＋ Enter by hand
          </button>
          <button
            type="button"
            onClick={onRescan}
            className="rounded-md border border-border text-text-muted text-sm font-medium py-2 hover:bg-bg transition"
          >
            📷 Scan again
          </button>
        </div>
      </div>
    )
  }

  // phase === 'scan'
  return <BarcodeScanner onDetected={onDetected} onManual={onManual} />
}

function ResultGroup({ title, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted mb-1">{title}</p>
      <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
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
        className="w-full text-left px-3 py-2 hover:bg-bg transition"
      >
        <p className="text-sm text-text flex items-center gap-2">
          <span className="truncate">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-success/10 text-success text-[10px] font-medium px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </p>
        <p className="text-xs text-text-muted">{subtitle}</p>
      </button>
    </li>
  )
}

function QuantityStep({ food, meal, servings, setServings, cost, setCost, busy, onConfirm, onBack }) {
  const s = Number(servings) || 0
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text">{food.name}</p>
        <p className="text-xs text-text-muted">
          {Math.round(Number(food.calories))} cal · {round1(food.protein)}g P per serving
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs font-medium text-text-muted mb-1">Servings</span>
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
          <span className="block text-xs font-medium text-text-muted mb-1">
            Cost / serving
          </span>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-sm" aria-hidden>
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

      <div className="rounded-lg bg-bg px-3 py-2 text-sm">
        <span className="font-semibold text-text">
          {Math.round(Number(food.calories) * s)} kcal
        </span>{' '}
        <span className="text-success">P {round1(Number(food.protein) * s)}g</span>{' '}
        <span className="text-interactive">C {round1(Number(food.carbs) * s)}g</span>{' '}
        <span className="text-chart-1">F {round1(Number(food.fat) * s)}g</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !(s > 0)}
          className="flex-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium py-2 transition disabled:opacity-50"
        >
          Add to {meal.label}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border text-text-muted text-sm font-medium px-4 py-2 hover:bg-bg transition"
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
  noPortionHint,
  liveMacros,
  amountLabel,
  pCost,
  setPCost,
  qty,
  busy,
  meal,
  barcode,
  onConfirm,
  onBack,
}) {
  const blocked = barcode ? !barcode.plausible?.ok : false
  const provenance =
    barcode?.meta?.dataSource === 'off'
      ? 'From Open Food Facts (community-maintained) — please check the numbers.'
      : barcode
        ? 'From the USDA branded database.'
        : null
  return (
    <div className="space-y-3">
      {barcode && (
        <div className="rounded-lg border border-interactive/30 bg-primary/10 px-3 py-2 space-y-1">
          <p className="text-xs text-interactive">
            📷 Scanned {barcode.meta?.upc ? <span className="tabular-nums">#{barcode.meta.upc}</span> : 'barcode'}
            {barcode.brand ? ` · ${barcode.brand}` : ''}
          </p>
          {provenance && <p className="text-[11px] text-interactive/80">{provenance}</p>}
        </div>
      )}

      {blocked && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-xs font-medium text-warning">
            These numbers look off ({barcode.plausible.reason}).
          </p>
          <p className="text-[11px] text-warning/90">
            Rather than trust them, scan the Nutrition Facts label or add this food by hand.
          </p>
        </div>
      )}

      <input
        value={pName}
        onChange={(e) => setPName(e.target.value)}
        placeholder="Food name"
        className={`w-full font-medium ${inputCls}`}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs font-medium text-text-muted mb-1">Amount</span>
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
          <span className="block text-xs font-medium text-text-muted mb-1">
            Serving size {loadingPortions && <span className="text-text-muted">· loading…</span>}
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
        <p className="text-xs text-text-muted">
          USDA has no preset portions for this food — log it by weight (grams or ounces).
          {noPortionHint ? <span className="text-text-muted"> As a guide, {noPortionHint}.</span> : ''}
        </p>
      )}

      {liveMacros && (
        <div className="rounded-lg bg-bg px-3 py-2">
          <p className="text-xs text-text-muted mb-1">Per {amountLabel()}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            <span className="font-semibold text-text">
              {Math.round(liveMacros.calories)} kcal
            </span>
            <span className="text-success">P {round1(liveMacros.protein)}g</span>
            <span className="text-interactive">C {round1(liveMacros.carbs)}g</span>
            <span className="text-chart-1">F {round1(liveMacros.fat)}g</span>
          </div>
        </div>
      )}

      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-sm" aria-hidden>
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
          disabled={busy || !pName.trim() || !(qty > 0) || blocked}
          className="flex-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium py-2 transition disabled:opacity-50"
        >
          Add & log to {meal.label}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border text-text-muted text-sm font-medium px-4 py-2 hover:bg-bg transition"
        >
          Back
        </button>
      </div>
      {picked && <p className="sr-only">Selected {picked.name}</p>}
    </div>
  )
}

function ManualCreate({ busy, onCancel, onCreate, defaultUpc }) {
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
      // Carry a scanned-but-unmatched barcode onto the food so a re-scan finds it.
      ...(defaultUpc ? { upc: defaultUpc } : {}),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">
          Create a food{defaultUpc ? <span className="ml-1 font-normal tabular-nums text-text-muted">· barcode #{defaultUpc}</span> : ''}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-muted hover:text-text"
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
        className="w-full rounded-md bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium py-1.5 transition disabled:opacity-50"
      >
        Create &amp; log
      </button>
    </form>
  )
}
