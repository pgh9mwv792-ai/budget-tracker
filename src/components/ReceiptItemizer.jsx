import { useEffect, useMemo, useState } from 'react'
import { rankTransactionMatches, itemKey, foodSearchQuery, perUnitCost } from '../lib/receiptMatch'
import { aggregatePantry, suggestFoodMapping } from '../lib/pantry'

// The itemized-receipt flow, rendered by ReceiptScanner once Claude has
// transcribed a receipt into line items. Two deliberate, verify-before-save
// steps (mirroring ReceiptScanner / SupplementScanner — nothing auto-commits):
//
//   1. MATCH — confirm the store/date/total, tick which lines are food, and pick
//      the Plaid transaction this receipt itemizes (or "no matching charge",
//      which falls back to creating a manual transaction). Saving here writes
//      the receipt + its items and links the transaction.
//   2. MAP  — for each food line, connect it to a library/USDA food. A remembered
//      rule pre-fills; otherwise search USDA or pick from the library, or skip.
//      Confirming a line remembers the rule and flows the receipt price into the
//      food's default cost.
//
// Props:
//   draft: { store_name, purchase_date, total, items:[{raw_name, price, quantity, unit, looks_like_food}] }
//   transactions, foods, categories: current app data
//   receiptItemRules: [{ item_key, food_id }] remembered mappings
//   matchedTransactionIds: Set of txn ids already claimed by another receipt
//   onSearchFoods(query): USDA search (returns per-100g matches)
//   onSaveReceipt({ receipt, items, matchedTransaction }) -> { receipt, transaction }
//   onMapItem({ item, food, itemKey }) -> updated item
//   onCreateFood(values) -> created library food
//   onApplyCategory(transactionId, categoryId): categorize the linked txn
//   onDone(summary): leave the flow (summary shown by the parent)
export default function ReceiptItemizer({
  draft,
  transactions = [],
  foods = [],
  categories = [],
  receiptItemRules = [],
  matchedTransactionIds,
  onSearchFoods,
  onSaveReceipt,
  onMapItem,
  onCreateFood,
  onApplyCategory,
  onDone,
}) {
  const [step, setStep] = useState('match') // match | map
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Editable header + per-line food flags. Seed is_food from the model's guess.
  const [store, setStore] = useState(draft.store_name || '')
  const [date, setDate] = useState(draft.purchase_date || '')
  const [total, setTotal] = useState(draft.total === '' ? '' : String(draft.total))
  const [items, setItems] = useState(
    draft.items.map((it) => ({ ...it, is_food: it.looks_like_food }))
  )

  // Which transaction the user chose: a txn object, or the sentinel 'none'.
  const [chosen, setChosen] = useState(null)

  // After save: the persisted receipt (items carry ids) + the linked txn.
  const [savedReceipt, setSavedReceipt] = useState(null)
  const [linkedTxn, setLinkedTxn] = useState(null)
  const [categoryApplied, setCategoryApplied] = useState(false)
  // Food actually mapped this session (itemId → food), so the pantry summary
  // updates live as lines get linked (savedReceipt.items isn't re-fetched here).
  const [mappedById, setMappedById] = useState({})

  const excludeIds = useMemo(
    () => new Set([...(matchedTransactionIds ?? [])]),
    [matchedTransactionIds]
  )

  // Ranked candidates recompute as the user edits the total/date/store.
  const { matches, nearMisses } = useMemo(
    () =>
      rankTransactionMatches(
        { total: Number(total), purchase_date: date, store_name: store },
        transactions,
        { alreadyMatchedIds: excludeIds }
      ),
    [total, date, store, transactions, excludeIds]
  )

  // Auto-select the best exact match the first time candidates appear, so the
  // common case is a single confirming tap.
  useEffect(() => {
    if (chosen == null && matches.length > 0) setChosen(matches[0].transaction)
  }, [matches, chosen])

  const toggleFood = (i) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, is_food: !it.is_food } : it)))

  const itemsSum = items.reduce((s, it) => s + (Number(it.price) || 0), 0)

  const save = async () => {
    const totalNum = Number(total)
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      setError('Enter the receipt total before continuing.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const matchedTransaction = chosen && chosen !== 'none' ? chosen : null
      const { receipt, transaction } = await onSaveReceipt({
        receipt: { store_name: store, purchase_date: date, total: totalNum },
        items,
        matchedTransaction,
      })
      setSavedReceipt(receipt)
      setLinkedTxn(transaction)
      setStep('map')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const foodItems = (savedReceipt?.items ?? []).filter((it) => it.is_food)

  // Nutrition brought home: overlay this session's mappings onto the saved items,
  // then aggregate. Foods created mid-flow live in mappedById, so include them.
  const pantry = useMemo(() => {
    const byId = new Map(foods.map((f) => [f.id, f]))
    for (const food of Object.values(mappedById)) if (food) byId.set(food.id, food)
    const items = foodItems.map((it) => {
      const mapped = mappedById[it.id]
      return mapped ? { ...it, food_id: mapped.id } : it
    })
    return aggregatePantry(items, byId)
  }, [foodItems, mappedById, foods])

  const onItemMapped = (itemId, food) => setMappedById((m) => ({ ...m, [itemId]: food }))

  const finish = () => {
    const mapped = foodItems.filter((it) => it.food_id).length
    onDone(
      `Saved ${store || 'receipt'} · $${Number(total).toFixed(2)} — ${mapped}/${foodItems.length} food items mapped.`
    )
  }

  // ---- STEP 1: match ----
  if (step === 'match') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Check the receipt & find the charge
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Store">
            <input value={store} onChange={(e) => setStore(e.target.value)} className={inputCls} placeholder="e.g. Whole Foods" />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Total (incl. tax)">
            <input type="number" step="0.01" min="0" value={total} onChange={(e) => setTotal(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {/* Line items — tick which are food. Discounts show as negative lines. */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={it.is_food}
                onChange={() => toggleFood(i)}
                title="Is this a food item?"
                className="accent-emerald-600 shrink-0"
              />
              <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">
                {it.raw_name}
                {it.quantity != null && (
                  <span className="text-slate-400 dark:text-slate-500"> · {it.quantity}{it.unit ? ` ${it.unit}` : ''}</span>
                )}
              </span>
              <span className={`shrink-0 tabular-nums ${Number(it.price) < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
                {it.price == null ? '—' : `$${Number(it.price).toFixed(2)}`}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{items.length} lines · items sum ${itemsSum.toFixed(2)}</span>
            {Math.abs(itemsSum - Number(total)) > 0.02 && Number(total) > 0 && (
              <span className="text-amber-600 dark:text-amber-400">doesn’t match total — tax/discounts expected</span>
            )}
          </div>
        </div>

        {/* Transaction candidates */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Which bank charge is this?</p>
          {matches.length === 0 && nearMisses.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              No matching Plaid charge found. You can still save — we’ll add a manual transaction.
            </p>
          )}
          {matches.map((m) => (
            <MatchOption key={m.transaction.id} m={m} selected={chosen === m.transaction} onChoose={() => setChosen(m.transaction)} />
          ))}
          {nearMisses.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Possible match — please confirm</p>
              {nearMisses.map((m) => (
                <MatchOption key={m.transaction.id} m={m} selected={chosen === m.transaction} onChoose={() => setChosen(m.transaction)} medium />
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer pt-1">
            <input
              type="radio"
              name="txn-match"
              checked={chosen === 'none'}
              onChange={() => setChosen('none')}
              className="accent-emerald-600"
            />
            No matching charge — create a manual transaction
          </label>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy || chosen == null}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Confirm & itemize'}
          </button>
          <button
            onClick={() => onDone(null)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ---- STEP 2: map food items to library foods ----
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Match items to your foods</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Linking prices your library — receipt prices flow into cost-per-protein. Buying isn’t eating, so nothing is logged.
        </p>
      </div>

      {/* Offer to categorize the linked transaction if it's uncategorized. */}
      {linkedTxn && !linkedTxn.category_id && !categoryApplied && (
        <CategoryPrompt
          categories={categories}
          onApply={async (categoryId) => {
            await onApplyCategory(linkedTxn.id, categoryId)
            setCategoryApplied(true)
          }}
        />
      )}

      {foodItems.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">No food items to map on this receipt.</p>
      )}

      <div className="space-y-2">
        {foodItems.map((item) => (
          <ItemMapRow
            key={item.id}
            item={item}
            foods={foods}
            receiptItemRules={receiptItemRules}
            onSearchFoods={onSearchFoods}
            onCreateFood={onCreateFood}
            onMap={onMapItem}
            onMapped={onItemMapped}
          />
        ))}
      </div>

      {pantry.nutritionItemCount > 0 && <PantrySummary pantry={pantry} />}

      {error && <ErrorBox>{error}</ErrorBox>}

      <button
        onClick={finish}
        className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition"
      >
        Done
      </button>
    </div>
  )
}

// One transaction candidate as a selectable radio row. `medium` candidates carry
// an amount wobble (coupon/tax) or an unconfirmed merchant, so they add a second
// line spelling out both amounts and why they differ — the user confirms with
// full context rather than trusting a silent best-guess.
function MatchOption({ m, selected, onChoose, medium }) {
  const t = m.transaction
  const merchant = t.merchant_name || t.note || t.name || 'Charge'
  const amountsDiffer = medium && Math.abs(m.amountDelta ?? 0) >= 0.01
  return (
    <label
      className={`block rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
        selected
          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
          : medium
            ? 'border-amber-200 dark:border-amber-900/60 hover:bg-amber-50/50 dark:hover:bg-amber-950/20'
            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <input type="radio" name="txn-match" checked={selected} onChange={onChoose} className="accent-emerald-600" />
        <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">${Number(t.amount).toFixed(2)}</span>
        <span className="text-slate-400 dark:text-slate-500">·</span>
        <span className="flex-1 min-w-0 truncate text-slate-600 dark:text-slate-300">{merchant}</span>
        <span className="text-slate-400 dark:text-slate-500 shrink-0">{t.date}</span>
      </div>
      {medium && (
        <p className="mt-1 pl-6 text-xs text-amber-700 dark:text-amber-300">
          {amountsDiffer
            ? `Charged $${m.txnAmount.toFixed(2)}, receipt says $${m.receiptTotal.toFixed(2)} — coupons or tax commonly cause this gap. Confirm it's the same purchase.`
            : 'Amount matches, but double-check the store and date before confirming.'}
        </p>
      )}
    </label>
  )
}

// Inline "set a category for this charge" prompt (optional, skippable).
function CategoryPrompt({ categories, onApply }) {
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const expenseCats = categories.filter((c) => c.kind === 'expense')
  if (done) return <p className="text-sm text-emerald-600 dark:text-emerald-400">✓ Category applied to the charge.</p>
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3 py-2 flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-600 dark:text-slate-300">This charge is uncategorized —</span>
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} w-auto`}>
        <option value="">choose a category</option>
        {expenseCats.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        disabled={!categoryId || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onApply(categoryId)
            setDone(true)
          } finally {
            setBusy(false)
          }
        }}
        className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 transition disabled:opacity-60"
      >
        Apply
      </button>
    </div>
  )
}

// One food line: shows the mapped/remembered food or a picker (USDA search +
// library select), confirms into a rule + cost update, or skips.
function ItemMapRow({ item, foods, receiptItemRules, onSearchFoods, onCreateFood, onMap, onMapped }) {
  const key = itemKey(item.raw_name)
  const rememberedFoodId = useMemo(() => {
    const rule = receiptItemRules.find((r) => r.item_key === key)
    return rule?.food_id ?? null
  }, [receiptItemRules, key])
  const rememberedFood = foods.find((f) => f.id === rememberedFoodId) || null

  // Alias/grade-aware best-guess from the library, shown only when there's no
  // remembered rule (a saved rule is a stronger, explicit signal).
  const suggestion = useMemo(
    () => (rememberedFood ? null : suggestFoodMapping(item.raw_name, foods)),
    [rememberedFood, item.raw_name, foods]
  )
  const suggestedFood = suggestion && suggestion.food !== rememberedFood ? suggestion.food : null

  const [state, setState] = useState(item.food_id ? 'mapped' : 'idle') // idle | open | mapped | skipped
  const [mappedName, setMappedName] = useState(item.food?.name ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Library + USDA suggestions for the picker.
  const [query, setQuery] = useState(foodSearchQuery(item.raw_name))
  const [usda, setUsda] = useState([])
  const [searching, setSearching] = useState(false)

  const libraryMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return foods.slice(0, 6)
    return foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 6)
  }, [foods, query])

  useEffect(() => {
    if (state !== 'open' || !onSearchFoods) return
    const q = query.trim()
    if (q.length < 2) {
      setUsda([])
      return
    }
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const res = await onSearchFoods(q)
        setUsda(res)
      } catch {
        setUsda([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [query, state, onSearchFoods])

  const commit = async (food) => {
    setBusy(true)
    setError(null)
    try {
      await onMap({ item, food, itemKey: key })
      onMapped?.(item.id, food)
      setMappedName(food.name)
      setState('mapped')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Confirm a USDA result: create the library food first, then map it.
  const commitUsda = async (r) => {
    setBusy(true)
    setError(null)
    try {
      const created = await onCreateFood({
        name: r.brand ? `${r.name} (${r.brand})` : r.name,
        servingDesc: '100 g',
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        cost: perUnitCost(item.price, item.quantity),
        fdcId: r.fdcId,
        source: 'usda',
      })
      await onMap({ item, food: created, itemKey: key })
      onMapped?.(item.id, created)
      setMappedName(created.name)
      setState('mapped')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const priceLabel =
    item.price == null ? '' : `$${Number(item.price).toFixed(2)}${item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}`

  if (state === 'mapped') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm">
        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
        <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">
          {item.raw_name} <span className="text-slate-400 dark:text-slate-500">→ {mappedName}</span>
        </span>
        <button onClick={() => setState('open')} className="text-xs text-slate-500 dark:text-slate-400 hover:underline shrink-0">
          Change
        </button>
      </div>
    )
  }

  if (state === 'skipped') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm text-slate-400 dark:text-slate-500">
        <span className="flex-1 min-w-0 truncate">{item.raw_name} — skipped</span>
        <button onClick={() => setState('open')} className="text-xs hover:underline shrink-0">Map</button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 min-w-0 truncate font-medium text-slate-700 dark:text-slate-200">{item.raw_name}</span>
        {priceLabel && <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{priceLabel}</span>}
      </div>

      {state === 'idle' && rememberedFood && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">from memory</span>
          <span className="flex-1 min-w-0 truncate text-slate-600 dark:text-slate-300">{rememberedFood.name}</span>
          <button
            disabled={busy}
            onClick={() => commit(rememberedFood)}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 transition disabled:opacity-60"
          >
            Use
          </button>
          <button onClick={() => setState('open')} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">Change</button>
        </div>
      )}

      {state === 'idle' && !rememberedFood && suggestedFood && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-2 py-0.5 shrink-0">suggested</span>
          <span className="flex-1 min-w-0 truncate text-slate-600 dark:text-slate-300">{suggestedFood.name}</span>
          <button
            disabled={busy}
            onClick={() => commit(suggestedFood)}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 transition disabled:opacity-60"
          >
            Use
          </button>
          <button onClick={() => setState('open')} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">Change</button>
          <button onClick={() => setState('skipped')} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">Skip</button>
        </div>
      )}

      {state === 'idle' && !rememberedFood && !suggestedFood && (
        <div className="flex gap-2">
          <button onClick={() => setState('open')} className="rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            Match a food
          </button>
          <button onClick={() => setState('skipped')} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">Skip</button>
        </div>
      )}

      {state === 'open' && (
        <div className="space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library or USDA…"
            className={inputCls}
          />
          {libraryMatches.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Your library</p>
              <div className="flex flex-wrap gap-1.5">
                {libraryMatches.map((f) => (
                  <button
                    key={f.id}
                    disabled={busy}
                    onClick={() => commit(f)}
                    className="rounded-full border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs px-2.5 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition disabled:opacity-60"
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
              USDA {searching && <span className="normal-case text-slate-400">— searching…</span>}
            </p>
            {usda.length === 0 && !searching && <p className="text-xs text-slate-400 dark:text-slate-500">No USDA matches yet.</p>}
            <div className="space-y-1">
              {usda.slice(0, 5).map((r) => (
                <button
                  key={r.fdcId}
                  disabled={busy}
                  onClick={() => commitUsda(r)}
                  className="w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition disabled:opacity-60"
                >
                  <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">
                    {r.name}
                    {r.brand && <span className="text-slate-400 dark:text-slate-500"> · {r.brand}</span>}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{Math.round(r.protein)}g P/100g</span>
                </button>
              ))}
            </div>
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button onClick={() => setState('skipped')} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">Skip this item</button>
        </div>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

function ErrorBox({ children }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2">
      {children}
    </div>
  )
}

// "What this shop bought" — the nutrition brought home from the mapped, weight-
// priced lines. Honest about coverage: shows the priced fraction with a ~ prefix
// (mirroring the Meals cost-per-protein) when not every dollar could be counted.
function PantrySummary({ pantry }) {
  const partial = pantry.coverage < 0.999
  const prefix = partial ? '~' : ''
  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4">
      <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-2">This shop brought home</h4>
      <div className="grid grid-cols-3 gap-3">
        <PantryStat label="Protein" value={`${prefix}${Math.round(pantry.protein)}g`} />
        <PantryStat label="Calories" value={`${prefix}${Math.round(pantry.calories).toLocaleString()}`} />
        <PantryStat
          label="$ / 100g protein"
          value={pantry.costPer100gProtein != null ? `${prefix}$${pantry.costPer100gProtein.toFixed(2)}` : '—'}
        />
      </div>
      {partial && (
        <p className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-300/70">
          From {Math.round(pantry.coverage * 100)}% of mapped spend — only weight-priced items with known macros are counted.
        </p>
      )}
    </div>
  )
}

function PantryStat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-emerald-700/80 dark:text-emerald-300/70">{label}</p>
      <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-100 tabular-nums">{value}</p>
    </div>
  )
}
