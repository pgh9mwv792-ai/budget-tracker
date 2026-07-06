import { useRef, useState } from 'react'
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
export default function ReceiptScanner({ categories = [], onAdd, itemize = null }) {
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)
  const [mode, setMode] = useState('simple') // simple | itemize
  const [status, setStatus] = useState('idle') // idle | reading | review | saving | itemize
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null) // { merchant, date, amount, categoryId, confidence }
  const [itemDraft, setItemDraft] = useState(null) // parseReceiptItemized result
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
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setError(null)
    setSavedNote(null)
    setStatus('reading')
    try {
      if (mode === 'itemize' && canItemize) {
        const result = await parseReceiptItemized({ file })
        setItemDraft(result)
        setStatus('itemize')
        return
      }
      const result = await parseReceipt({ file, categories })
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
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
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
        onChange={handleFile}
        className="hidden"
      />

      {status !== 'review' && status !== 'itemize' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add a receipt</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mode === 'itemize'
                ? 'I’ll transcribe every line, match it to your bank charge, and price your foods.'
                : 'Take a photo, or upload a screenshot or PDF — I’ll read the total and category for you.'}
            </p>
            {canItemize && (
              <div className="mt-2 inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
                <button
                  onClick={() => setMode('simple')}
                  className={`px-2.5 py-1 rounded-md transition ${mode === 'simple' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  Quick total
                </button>
                <button
                  onClick={() => setMode('itemize')}
                  className={`px-2.5 py-1 rounded-md transition ${mode === 'itemize' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
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
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Reading your receipt — this takes a few seconds…</p>
      )}

      {status === 'review' && draft && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Check the details</h3>
            {draft.confidence === 'low' && (
              <span className="text-xs rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5">
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
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'saving' ? 'Adding…' : 'Add transaction'}
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
