import { useRef, useState } from 'react'
import { parseSupplement } from '../lib/supplement'
import { reportError } from '../lib/report'
import { normalizeFoodNutrients, normalizeNutrient, NUTRIENT_BY_ID } from '../lib/nutrients'

// "Scan a supplement label" flow: pick/snap a photo of a Supplement Facts panel
// → Claude reads it → an editable review card of ingredients → saves a food into
// the library (source 'supplement_scan') that logs like any other food. Mirrors
// ReceiptScanner: the review step is deliberate, since OCR of a dense label is
// good but not perfect and a human confirm keeps bad micros out.
//
// Props:
//   onSave(values): create a foods row. Same shape createFood accepts.
export default function SupplementScanner({ onSave }) {
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | reading | review | saving
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  // Supplements are usually taken every day, so default the "daily stack" opt-in
  // on — the user can uncheck it for a one-off before saving.
  const [addToStack, setAddToStack] = useState(true)

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
      const result = await parseSupplement({ file })
      setDraft(result)
      setStatus('review')
    } catch (err) {
      // Show the message and also send it to Sentry with the model's raw reply
      // (when we captured one) so a "reads nothing" report is diagnosable.
      setError(err.message)
      reportError(err, { step: 'parseSupplement', rawResponse: err.rawResponse })
      setStatus('idle')
    }
  }

  const setField = (field, value) => setDraft((d) => ({ ...d, [field]: value }))

  const updateIngredient = (i, patch) =>
    setDraft((d) => ({
      ...d,
      ingredients: d.ingredients.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)),
    }))

  const removeIngredient = (i) =>
    setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((_, idx) => idx !== i) }))

  const addIngredient = () =>
    setDraft((d) => ({
      ...d,
      ingredients: [...d.ingredients, { name: '', amount: '', unit: '', amountNormalized: null, percentDv: null }],
    }))

  const save = async () => {
    if (!draft) return
    const product = draft.product.trim()
    if (!product) {
      setError('Give the supplement a name before saving.')
      return
    }
    const ingredients = draft.ingredients.filter((ing) => ing.name.trim())
    setStatus('saving')
    setError(null)
    try {
      // Raw per-serving rows exactly as read from the label (form preserved).
      const rawNutrients = ingredients.map((ing) => ({
        name: ing.name.trim(),
        amount: ing.amount === '' ? null : Number(ing.amount),
        unit: ing.unit.trim(),
        per: 'serving',
        amount_normalized_mcg_or_mg: ing.amountNormalized ?? null,
        percent_dv: ing.percentDv ?? null,
      }))
      // Canonical per-serving set alongside the raw rows (supplements are already
      // per serving, so scale is 1). Normalized rows carry an `id`.
      const normalized = normalizeFoodNutrients(rawNutrients, { source: 'label', servingScale: 1 })
      await onSave({
        name: draft.brand.trim() ? `${product} (${draft.brand.trim()})` : product,
        servingDesc: draft.servingSize.trim() || '1 serving',
        calories: Number(draft.calories) || 0,
        protein: Number(draft.protein) || 0,
        carbs: Number(draft.carbs) || 0,
        fat: Number(draft.fat) || 0,
        cost: null,
        fdcId: null,
        source: 'supplement_scan',
        isStack: addToStack,
        // Ingredient list captured per serving into the shared nutrients jsonb.
        nutrients: [...rawNutrients, ...normalized],
      })
      setSavedNote(`Saved ${product} — log it from any meal below.`)
      setDraft(null)
      setStatus('idle')
    } catch (err) {
      // A save failure here is usually a schema/RLS problem (e.g. migration 0014
      // not applied, so the nutrients/source columns are missing) — surface it
      // and report it rather than swallowing it.
      setError(err.message)
      reportError(err, { step: 'saveSupplement' })
      setStatus('review')
    }
  }

  const cancel = () => {
    setDraft(null)
    setStatus('idle')
    setError(null)
  }

  // What each parsed row will count as on the Meals tab, computed live so edits
  // reflect immediately. `mapped` is the canonical micronutrient name (e.g.
  // "Zinc") or null when the row's name doesn't match a tracked nutrient.
  const detected = (draft?.ingredients ?? []).map((ing) => {
    const norm = normalizeNutrient(ing.name, ing.amount, ing.unit, 'label')
    return { ...ing, mapped: norm ? NUTRIENT_BY_ID.get(norm.id)?.name ?? null : null }
  })

  return (
    <div>
      {/* Camera: opens the camera directly on phones. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      {/* Upload: pick an existing photo, screenshot, or PDF. */}
      <input ref={uploadRef} type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" />

      {status !== 'review' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text">Scan a supplement label</h4>
            <p className="text-xs text-text-muted">
              Photograph the Supplement Facts panel — I’ll read the serving size and ingredients for you to check.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={openCamera}
              disabled={status === 'reading'}
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'reading' ? 'Reading…' : '📷 Take photo'}
            </button>
            <button
              onClick={openUpload}
              disabled={status === 'reading'}
              className="rounded-lg border border-border text-text text-sm font-medium px-4 py-2 hover:bg-bg transition disabled:opacity-60"
            >
              📎 Upload
            </button>
          </div>
        </div>
      )}

      {status === 'reading' && (
        <p className="mt-3 text-sm text-text-muted">Reading the label — this takes a few seconds…</p>
      )}

      {status === 'review' && draft && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-text">Check the label</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Product">
              <input value={draft.product} onChange={(e) => setField('product', e.target.value)} placeholder="e.g. Vitamin D3" className={inputCls} />
            </Field>
            <Field label="Brand">
              <input value={draft.brand} onChange={(e) => setField('brand', e.target.value)} placeholder="e.g. Now Foods" className={inputCls} />
            </Field>
            <Field label="Serving size">
              <input value={draft.servingSize} onChange={(e) => setField('servingSize', e.target.value)} placeholder="e.g. 2 capsules" className={inputCls} />
            </Field>
            <Field label="Calories (per serving)">
              <input type="number" step="1" min="0" value={draft.calories} onChange={(e) => setField('calories', e.target.value)} className={inputCls} />
            </Field>
          </div>

          {(Number(draft.calories) > 0 || Number(draft.protein) > 0 || Number(draft.carbs) > 0 || Number(draft.fat) > 0) && (
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
          )}

          {detected.length > 0 && (
            <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2.5">
              <p className="text-xs font-semibold text-success mb-1.5">Will be logged</p>
              <ul className="space-y-1">
                {detected.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="tabular-nums font-semibold text-text shrink-0 w-16 text-right">
                      {d.amount === '' ? '—' : d.amount} {d.unit}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-text-muted">
                      {d.name || <span className="italic text-warning">add a name below →</span>}
                    </span>
                    {d.mapped ? (
                      <span className="shrink-0 rounded-full bg-success text-on-primary text-xs font-medium px-2 py-0.5">{d.mapped}</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-warning/20 text-warning text-xs font-medium px-2 py-0.5">
                        not counted
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-success">
                Green pills count toward that micronutrient on the Meals tab. Fix any “not counted” row below.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-text-muted">Ingredients (edit if needed)</span>
              <button onClick={addIngredient} className="text-xs text-interactive hover:underline">
                + Add row
              </button>
            </div>
            {draft.ingredients.length === 0 && (
              <p className="text-xs text-text-muted">No ingredients read — add rows by hand if needed.</p>
            )}
            <div className="space-y-2">
              {draft.ingredients.map((ing, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={ing.name}
                    onChange={(e) => updateIngredient(i, { name: e.target.value })}
                    placeholder="Ingredient (keep the form, e.g. Zinc (as glycinate))"
                    className={`flex-1 min-w-0 ${inputCls}`}
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={ing.amount}
                    onChange={(e) => updateIngredient(i, { amount: e.target.value })}
                    placeholder="amt"
                    title="Amount"
                    className={`w-20 ${inputCls}`}
                  />
                  <input
                    value={ing.unit}
                    onChange={(e) => updateIngredient(i, { unit: e.target.value })}
                    placeholder="unit"
                    title="Unit"
                    className={`w-16 ${inputCls}`}
                  />
                  <button
                    onClick={() => removeIngredient(i)}
                    title="Remove"
                    className="text-danger hover:text-danger text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              IU units (vitamins A, D, E) keep their label value; a standard metric conversion is stored where one exists.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={addToStack}
              onChange={(e) => setAddToStack(e.target.checked)}
              className="rounded border-border text-primary focus:ring-interactive"
            />
            Add to my daily stack (one-tap “Log my stack” on the Meals tab)
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={status === 'saving'}
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'saving' ? 'Saving…' : 'Save to library'}
            </button>
            <button
              onClick={cancel}
              className="rounded-lg border border-border text-text-muted text-sm font-medium px-4 py-2 hover:bg-bg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {savedNote && <p className="mt-3 text-sm text-success">✓ {savedNote}</p>}
      {error && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm px-3 py-2">
          {error}
        </div>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-border bg-surface text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text-muted mb-1">{label}</span>
      {children}
    </label>
  )
}
