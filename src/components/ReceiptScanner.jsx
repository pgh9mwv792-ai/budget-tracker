import { useEffect, useRef, useState } from 'react'
import { parseReceipt, parseReceiptItemized } from '../lib/receipt'
import ReceiptItemizer from './ReceiptItemizer'

// "Scan receipt" flow: pick/snap a photo → Claude reads it → an editable review
// card → creates the transaction. The review step is deliberate: OCR is good,
// not perfect, so a human confirm keeps bad data out of the budget.
//
// Two modes, chosen before scanning:
//   • Quick total (default) — one editable transaction, as before.
//   • Itemize — Claude transcribes every line, the receipt is matched to a Plaid
//     charge, and food lines map into the library (see ReceiptItemizer). The
//     `itemize` prop bundle carries the extra data/actions that flow needs; when
//     it's absent the toggle is hidden and only the simple mode shows.
//
// Props:
//   categories: all categories (expense ones are offered in the picker)
//   onAdd(values): create a transaction { date, amount, kind, categoryId, note }
//   itemize: { transactions, foods, receiptItemRules, matchedTransactionIds,
//     onSearchFoods, onSaveReceipt, onMapItem, onCreateFood, onApplyCategory }
//   autoFocus: when true (a new user arrived here from the receipt-first
//     onboarding step), scroll this card into view and pulse a highlight ring so
//     it's unmistakably the thing to use next. We deliberately do NOT auto-open
//     the camera — mobile browsers block that outside a direct tap.
//   onAutoFocusDone(): clear the one-shot autoFocus signal in the parent.
export default function ReceiptScanner({
  categories = [],
  onAdd,
  itemize = null,
  autoFocus = false,
  onAutoFocusDone,
}) {
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)
  const rootRef = useRef(null)
  const [highlighted, setHighlighted] = useState(false)

  useEffect(() => {
    if (!autoFocus) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlighted(true)
    const t = setTimeout(() => setHighlighted(false), 2500)
    onAutoFocusDone?.()
    return () => clearTimeout(t)
  }, [autoFocus, onAutoFocusDone])
  const [mode, setMode] = useState('simple') // simple | itemize
  const [status, setStatus] = useState('idle') // idle | reading | review | saving | itemize
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null) // { merchant, date, amount, categoryId, confidence }
  const [itemDraft, setItemDraft] = useState(null) // parseReceiptItemized result
  const [pages, setPages] = useState([]) // itemize mode: photos of one receipt (e.g. items page + totals page)
  const [savedNote, setSavedNote] = useState(null)

  const expenseCategories = categories.filter((c) => c.kind === 'expense')
  const canItemize = Boolean(itemize)

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
    const selected = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file later
    if (!selected.length) return
    setError(null)
    setSavedNote(null)

    // Itemize mode collects photos into a tray (Whole Foods splits items and
    // totals onto separate slips) — the user reads them together, not on select.
    if (mode === 'itemize' && canItemize) {
      setPages((cur) => [...cur, ...selected])
      return
    }

    setStatus('reading')
    try {
      const result = await parseReceipt({ file: selected[0], categories })
      const matched = expenseCategories.find((c) => c.name === result.category)
      setDraft({
        merchant: result.merchant,
        date: result.date,
        amount: result.amount,
        categoryId: matched?.id ?? '',
        confidence: result.confidence,
      })
      setStatus('review')
    } catch (err) {
      setError(err.message)
      setStatus('idle')
    }
  }

  // Send every collected page to Claude as ONE receipt (a single AI call).
  const readItemized = async () => {
    if (!pages.length) return
    setError(null)
    setSavedNote(null)
    setStatus('reading')
    try {
      const result = await parseReceiptItemized({ files: pages })
      setItemDraft(result)
      setPages([])
      setStatus('itemize')
    } catch (err) {
      setError(err.message)
      setStatus('idle')
    }
  }

  const removePage = (idx) => setPages((cur) => cur.filter((_, i) => i !== idx))

  // Leave the itemized flow (finished or cancelled). `summary` is a saved-note
  // string when a receipt was persisted, or null on cancel.
  const finishItemize = (summary) => {
    setItemDraft(null)
    setStatus('idle')
    if (summary) setSavedNote(summary)
  }

  const save = async () => {
    if (!draft) return
    const amount = Number(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount before adding.')
      return
    }
    setStatus('saving')
    setError(null)
    try {
      await onAdd({
        date: draft.date,
        amount,
        kind: 'expense',
        categoryId: draft.categoryId || null,
        note: draft.merchant || null,
      })
      setSavedNote(`Added ${draft.merchant || 'expense'} · $${amount.toFixed(2)}`)
      setDraft(null)
      setStatus('idle')
    } catch (err) {
      setError(err.message)
      setStatus('review')
    }
  }

  const cancel = () => {
    setDraft(null)
    setStatus('idle')
    setError(null)
  }

  return (
    <div
      ref={rootRef}
      className={`bg-surface rounded-xl border shadow-sm p-4 transition-shadow ${
        highlighted
          ? 'border-interactive ring-2 ring-interactive/60'
          : 'border-border'
      }`}
    >
      {/* Camera: opens the camera directly on phones. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      {/* Upload: pick an existing photo, a screenshot (e.g. an in-app receipt),
          or a PDF from the library/files. No `capture`, so it doesn't force the camera. */}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*,application/pdf"
        multiple={mode === 'itemize'}
        onChange={handleFile}
        className="hidden"
      />

      {status !== 'review' && status !== 'itemize' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text">Add a receipt</h3>
            <p className="text-xs text-text-muted">
              {mode === 'itemize'
                ? 'Add a photo of the items and another of the total — I’ll read them as one receipt, match your bank charge, and price your foods.'
                : 'Take a photo, or upload a screenshot or PDF — I’ll read the total and category for you.'}
            </p>
            {canItemize && (
              <div className="mt-2 inline-flex rounded-lg border border-border p-0.5 text-xs">
                <button
                  onClick={() => {
                    setMode('simple')
                    setPages([])
                    setError(null)
                  }}
                  className={`px-2.5 py-1 rounded-md transition ${mode === 'simple' ? 'bg-primary text-on-primary' : 'text-text-muted'}`}
                >
                  Quick total
                </button>
                <button
                  onClick={() => setMode('itemize')}
                  className={`px-2.5 py-1 rounded-md transition ${mode === 'itemize' ? 'bg-primary text-on-primary' : 'text-text-muted'}`}
                >
                  Itemize
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={openCamera}
              disabled={status === 'reading'}
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'reading' ? 'Reading…' : mode === 'itemize' ? '📷 Add photo' : '📷 Take photo'}
            </button>
            <button
              onClick={openUpload}
              disabled={status === 'reading'}
              className="rounded-lg border border-border text-text text-sm font-medium px-4 py-2 hover:bg-primary-tint transition disabled:opacity-60"
            >
              {mode === 'itemize' ? '📎 Add images' : '📎 Upload'}
            </button>
          </div>
        </div>
      )}

      {status !== 'review' && status !== 'itemize' && mode === 'itemize' && pages.length > 0 && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-text-muted mb-2">
            {pages.length} {pages.length === 1 ? 'photo' : 'photos'} added — add the total slip too, then read them together.
          </p>
          <ul className="flex flex-wrap gap-2 mb-3">
            {pages.map((f, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md bg-bg text-text-muted text-xs px-2 py-1"
              >
                <span className="max-w-[9rem] truncate">📄 {f.name || `Page ${i + 1}`}</span>
                <button
                  onClick={() => removePage(i)}
                  disabled={status === 'reading'}
                  title="Remove this photo"
                  className="text-text-muted hover:text-danger disabled:opacity-50"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={readItemized}
            disabled={status === 'reading'}
            className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
          >
            {status === 'reading' ? 'Reading…' : `Read receipt (${pages.length})`}
          </button>
        </div>
      )}

      {status === 'reading' && (
        <p className="mt-3 text-sm text-text-muted">Reading your receipt — this takes a few seconds…</p>
      )}

      {status === 'review' && draft && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Check the details</h3>
            {draft.confidence === 'low' && (
              <span className="text-xs rounded-full bg-warning/10 text-warning px-2 py-0.5">
                Low confidence — double-check
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Store / note">
              <input
                value={draft.merchant}
                onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
                placeholder="e.g. Whole Foods"
                className={inputCls}
              />
            </Field>
            <Field label="Amount">
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Category">
              <select
                value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                className={inputCls}
              >
                <option value="">Uncategorized</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={status === 'saving'}
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'saving' ? 'Adding…' : 'Add transaction'}
            </button>
            <button
              onClick={cancel}
              className="rounded-lg border border-border text-text-muted text-sm font-medium px-4 py-2 hover:bg-primary-tint transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === 'itemize' && itemDraft && canItemize && (
        <div className="mt-2">
          <ReceiptItemizer
            draft={itemDraft}
            transactions={itemize.transactions}
            foods={itemize.foods}
            categories={categories}
            receiptItemRules={itemize.receiptItemRules}
            matchedTransactionIds={itemize.matchedTransactionIds}
            onSearchFoods={itemize.onSearchFoods}
            onSaveReceipt={itemize.onSaveReceipt}
            onMapItem={itemize.onMapItem}
            onCreateFood={itemize.onCreateFood}
            onApplyCategory={itemize.onApplyCategory}
            onDone={finishItemize}
          />
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
