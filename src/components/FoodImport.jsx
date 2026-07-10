import { useMemo, useRef, useState } from 'react'
import { parseFoodCsv } from '../lib/foodImport'
import { todayISO } from '../lib/dateHelpers'

const MEAL_LABEL = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  supplement: 'Supplements',
}

const FORMAT_LABEL = { myfitnesspal: 'MyFitnessPal', cronometer: 'Cronometer' }

// Import a MyFitnessPal / Cronometer food-diary CSV. Collapsed by default, it
// lives at the bottom of the Meals tab. Nothing is logged until the user reviews
// the parsed rows and taps Import — rows are excludable and any missing date
// falls back to a single chosen date. Each imported entry becomes one food_log
// at servings = 1 (the exporters already give per-entry totals).
export default function FoodImport({ onImportLogs }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState(null) // parseFoodCsv output
  const [fileName, setFileName] = useState('')
  const [excluded, setExcluded] = useState(() => new Set())
  const [fallbackDate, setFallbackDate] = useState(todayISO())
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const reset = () => {
    setResult(null)
    setFileName('')
    setExcluded(new Set())
    setSummary(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setSummary(null)
    setFileName(file.name)
    try {
      const text = await file.text()
      const parsed = parseFoodCsv(text)
      setResult(parsed)
      setExcluded(new Set())
      if (parsed.error) setError(parsed.error)
    } catch {
      setError('Could not read that file.')
      setResult(null)
    }
  }

  const rows = useMemo(() => result?.rows ?? [], [result])
  const toImport = useMemo(() => rows.filter((_, i) => !excluded.has(i)), [rows, excluded])
  const needsFallback = useMemo(() => toImport.some((r) => !r.date), [toImport])

  const toggle = (i) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const doImport = async () => {
    if (toImport.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const drafts = toImport.map((r) => ({
        date: r.date || fallbackDate,
        meal: r.meal ?? null,
        name: r.name,
        servings: 1,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        cost: null,
      }))
      await onImportLogs(drafts)
      setSummary(`Imported ${drafts.length} entr${drafts.length === 1 ? 'y' : 'ies'} to your diary.`)
      setResult(null)
      setFileName('')
      setExcluded(new Set())
      if (inputRef.current) inputRef.current.value = ''
    } catch (err) {
      setError(err.message || 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

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
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Import a food diary</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">MyFitnessPal · Cronometer</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Export your food log as CSV from MyFitnessPal or Cronometer, then choose the file. You’ll review everything
            before anything is added.
          </p>

          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 dark:file:bg-emerald-600 file:text-white file:text-xs file:font-medium file:px-3 file:py-1.5 file:cursor-pointer"
            />
            {(result || fileName) && (
              <button onClick={reset} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">
                Clear
              </button>
            )}
          </div>

          {summary && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm px-3 py-2">
              {summary}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Detected <span className="font-medium text-slate-700 dark:text-slate-200">{FORMAT_LABEL[result.format]}</span> ·{' '}
                  {toImport.length} of {rows.length} selected
                  {result.skipped > 0 ? ` · ${result.skipped} blank row(s) skipped` : ''}
                </span>
              </div>

              {needsFallback && (
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  Some rows have no date — use:
                  <input
                    type="date"
                    value={fallbackDate}
                    onChange={(e) => setFallbackDate(e.target.value)}
                    className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                  />
                </label>
              )}

              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r, i) => {
                  const on = !excluded.has(i)
                  return (
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 text-sm ${on ? '' : 'opacity-40'}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(i)} className="accent-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-slate-700 dark:text-slate-200">{r.name}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {(r.date || fallbackDate)}{r.meal ? ` · ${MEAL_LABEL[r.meal]}` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                        {Math.round(r.calories)} cal · {Math.round(r.protein)}g P
                      </span>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={doImport}
                disabled={importing || toImport.length === 0}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-60"
              >
                {importing ? 'Importing…' : `Import ${toImport.length} entr${toImport.length === 1 ? 'y' : 'ies'}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
