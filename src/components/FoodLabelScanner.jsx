import { useRef, useState } from 'react'
import { parseFoodLabel } from '../lib/foodLabel'
import { reportError } from '../lib/report'
import { normalizeFoodNutrients, normalizeNutrient, NUTRIENT_BY_ID } from '../lib/nutrients'

// "Scan a food label" flow: pick/snap a photo of a packaged food's Nutrition
// Facts panel → Claude reads it → an editable review card of macros + the
// micronutrient rows → saves a branded food into the library (source
// 'label_scan') that logs like any other food. Sibling of SupplementScanner;
// they share the same secure vision pipeline (see lib/foodLabel.js).
//
// Props:
//   onSave(values): create a foods row. Same shape createFood accepts. Should
//   return the created food (the caller's onAddFood does).
export default function FoodLabelScanner({ onSave }) {
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)
  const frontRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | reading | review | saving
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  // The Nutrition Facts image we read, kept so an optional front-of-package photo
  // can be sent alongside it to recover a missing product name/brand.
  const [factsFile, setFactsFile] = useState(null)
  const [frontBusy, setFrontBusy] = useState(false)
  // Optional typical cost per serving — stored on the food so future logs
  // pre-fill it (the app's established "remembered cost" behavior).
  const [cost, setCost] = useState('')
  // Short spoken names ("eggs", "my eggs") the assistant + search resolve on.
  const [aliasText, setAliasText] = useState('')

  const openCamera = () => {
    setError(null)
    setSavedNote(null)
    cameraRef.current?.click()
  }
  const openUpload = () => {
    setError(null)
    setSavedNote(null)
    uploadRef.current?.click()
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setError(null)
    setSavedNote(null)
    setStatus('reading')
    try {
      const result = await parseFoodLabel({ file })
      setFactsFile(file)
      setDraft(result)
      setCost('')
      setAliasText('')
      setStatus('review')
    } catch (err) {
      setError(err.message)
      reportError(err, { step: 'parseFoodLabel', rawResponse: err.rawResponse })
      setStatus('idle')
    }
  }

  // Optional second photo: the FRONT of the package, used only to fill a missing
  // product name/brand. Re-runs the read with both images and merges just the
  // name fields (never the numbers), leaving the user's other edits intact.
  const handleFront = async (e) => {
    const front = e.target.files?.[0]
    e.target.value = ''
    if (!front || !factsFile) return
    setError(null)
    setFrontBusy(true)
    try {
      const result = await parseFoodLabel({ file: factsFile, frontFile: front })
      setDraft((d) => ({
        ...d,
        product: d.product?.trim() ? d.product : result.product,
        brand: d.brand?.trim() ? d.brand : result.brand,
      }))
    } catch (err) {
      setError(err.message)
      reportError(err, { step: 'parseFoodLabelFront', rawResponse: err.rawResponse })
    } finally {
      setFrontBusy(false)
    }
  }

  const setField = (field, value) => setDraft((d) => ({ ...d, [field]: value }))

  const updateNutrient = (i, patch) =>
    setDraft((d) => ({
      ...d,
      nutrients: d.nutrients.map((n, idx) => (idx === i ? { ...n, ...patch } : n)),
    }))

  const removeNutrient = (i) =>
    setDraft((d) => ({ ...d, nutrients: d.nutrients.filter((_, idx) => idx !== i) }))

  const addNutrient = () =>
    setDraft((d) => ({
      ...d,
      nutrients: [...d.nutrients, { name: '', amount: '', unit: '', amountNormalized: null, percentDv: null }],
    }))

  const save = async () => {
    if (!draft) return
    const product = draft.product.trim()
    if (!product) {
      setError('Give the food a name before saving.')
      return
    }
    const rows = draft.nutrients.filter((n) => n.name.trim())
    setStatus('saving')
    setError(null)
    try {
      // Raw per-serving rows exactly as read from the label (form preserved).
      const rawNutrients = rows.map((n) => ({
        name: n.name.trim(),
        amount: n.amount === '' ? null : Number(n.amount),
        unit: n.unit.trim(),
        per: 'serving',
        amount_normalized_mcg_or_mg: n.amountNormalized ?? null,
        percent_dv: n.percentDv ?? null,
      }))
      // Nutrition Facts rows are already per serving, so scale is 1. Normalized
      // rows carry an `id` and count toward the day's micronutrient totals.
      const normalized = normalizeFoodNutrients(rawNutrients, { source: 'label', servingScale: 1 })
      const aliases = aliasText
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
      await onSave({
        name: draft.brand.trim() ? `${product} (${draft.brand.trim()})` : product,
        servingDesc: draft.servingSize.trim() || '1 serving',
        calories: Number(draft.calories) || 0,
        protein: Number(draft.protein) || 0,
        carbs: Number(draft.carbs) || 0,
        fat: Number(draft.fat) || 0,
        cost: cost === '' ? null : Number(cost),
        fdcId: null,
        source: 'label_scan',
        aliases,
        nutrients: [...rawNutrients, ...normalized],
      })
      setSavedNote(`Saved ${product} — log it from any meal below.`)
      setDraft(null)
      setFactsFile(null)
      setStatus('idle')
    } catch (err) {
      setError(err.message)
      reportError(err, { step: 'saveFoodLabel' })
      setStatus('review')
    }
  }

  const cancel = () => {
    setDraft(null)
    setFactsFile(null)
    setStatus('idle')
    setError(null)
  }

  // What each parsed micronutrient row will count as on the Meals tab, computed
  // live so edits reflect immediately.
  const detected = (draft?.nutrients ?? []).map((n) => {
    const norm = normalizeNutrient(n.name, n.amount, n.unit, 'label')
    return { ...n, mapped: norm ? NUTRIENT_BY_ID.get(norm.id)?.name ?? null : null }
  })

  return (
    <div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      <input ref={uploadRef} type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" />
      <input ref={frontRef} type="file" accept="image/*" capture="environment" onChange={handleFront} className="hidden" />

      {status !== 'review' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Scan a food label</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Photograph the Nutrition Facts panel — I’ll read the serving size, macros, and vitamins for you to check.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={openCamera}
              disabled={status === 'reading'}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'reading' ? 'Reading…' : '📷 Take photo'}
            </button>
            <button
              onClick={openUpload}
              disabled={status === 'reading'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-60"
            >
              📎 Upload
            </button>
          </div>
        </div>
      )}

      {status === 'reading' && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Reading the label — this takes a few seconds…</p>
      )}

      {status === 'review' && draft && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Check the label</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Product">
              <input value={draft.product} onChange={(e) => setField('product', e.target.value)} placeholder="e.g. Large Eggs" className={inputCls} />
            </Field>
            <Field label="Brand">
              <input value={draft.brand} onChange={(e) => setField('brand', e.target.value)} placeholder="e.g. Vital Farms" className={inputCls} />
            </Field>
            <Field label="Serving size">
              <input value={draft.servingSize} onChange={(e) => setField('servingSize', e.target.value)} placeholder="e.g. 2 eggs (100 g)" className={inputCls} />
            </Field>
            <Field label="Calories (per serving)">
              <input type="number" step="1" min="0" value={draft.calories} onChange={(e) => setField('calories', e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Protein (g)">
              <input type="number" step="0.1" min="0" value={draft.protein} onChange={(e) => setField('protein', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Carbs (g)">
              <input type="number" step="0.1" min="0" value={draft.carbs} onChange={(e) => setField('carbs', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Fat (g)">
              <input type="number" step="0.1" min="0" value={draft.fat} onChange={(e) => setField('fat', e.target.value)} className={inputCls} />
            </Field>
          </div>

          {!draft.product.trim() && (
            <button
              type="button"
              onClick={() => frontRef.current?.click()}
              disabled={frontBusy}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-60"
            >
              {frontBusy ? 'Reading front…' : '📷 Add a front-of-package photo to fill the name'}
            </button>
          )}

          {detected.length > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2.5">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 mb-1.5">Vitamins &amp; minerals</p>
              <ul className="space-y-1">
                {detected.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100 shrink-0 w-16 text-right">
                      {d.amount === '' ? '—' : d.amount} {d.unit}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                      {d.name || <span className="italic text-amber-600 dark:text-amber-400">add a name below →</span>}
                    </span>
                    {d.mapped ? (
                      <span className="shrink-0 rounded-full bg-emerald-600 text-white text-xs font-medium px-2 py-0.5">{d.mapped}</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-xs font-medium px-2 py-0.5">
                        not counted
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-emerald-700/80 dark:text-emerald-400/70">
                Green pills count toward that micronutrient on the Meals tab. Fix any “not counted” row below.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Vitamins &amp; minerals (edit if needed)</span>
              <button onClick={addNutrient} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                + Add row
              </button>
            </div>
            {draft.nutrients.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500">No vitamins/minerals read — add rows by hand if needed.</p>
            )}
            <div className="space-y-2">
              {draft.nutrients.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={n.name}
                    onChange={(e) => updateNutrient(i, { name: e.target.value })}
                    placeholder="Nutrient (e.g. Vitamin D, Calcium, Iron)"
                    className={`flex-1 min-w-0 ${inputCls}`}
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={n.amount}
                    onChange={(e) => updateNutrient(i, { amount: e.target.value })}
                    placeholder="amt"
                    title="Amount"
                    className={`w-20 ${inputCls}`}
                  />
                  <input
                    value={n.unit}
                    onChange={(e) => updateNutrient(i, { unit: e.target.value })}
                    placeholder="unit"
                    title="Unit"
                    className={`w-16 ${inputCls}`}
                  />
                  <button
                    onClick={() => removeNutrient(i)}
                    title="Remove"
                    className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Typical cost per serving (optional)">
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
            </Field>
            <Field label="Quick names (optional, comma-separated)">
              <input
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                placeholder="e.g. eggs, my eggs"
                className={inputCls}
              />
            </Field>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-1">
            Quick names let you say “log 2 eggs” to the assistant and have it pick this food.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={status === 'saving'}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'saving' ? 'Saving…' : 'Save to library'}
            </button>
            <button
              onClick={cancel}
              className="rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {savedNote && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">✓ {savedNote}</p>}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2">
          {error}
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
