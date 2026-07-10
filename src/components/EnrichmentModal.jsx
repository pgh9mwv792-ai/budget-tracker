import { useEffect, useState } from 'react'
import { buildEnrichment } from '../lib/foodEnrich'

// Auto-proposed micronutrient enrichment, shown right after a scanned/looked-up
// food is saved (and reachable from the low-coverage "fix" affordance). It picks
// a generic USDA equivalent by name, previews only the nutrients the food is
// MISSING (scaled to its serving), and offers three choices:
//   • Add these        — merge the borrowed rows (tagged enriched_from), keep going
//   • Pick a different  — reveal a search to choose another generic
//   • Skip for now      — remember the skip on the food so we don't nag again
//
// Borrowed rows carry `enriched_from: <fdcId>` and the food's own label numbers
// are never touched — same provenance contract as the manual EnrichPanel.
//
// Props:
//   food:          the just-saved (or being-fixed) foods row.
//   searchTerm:    optional first query (defaults to the food's name); Part C
//                  passes a grade-aware term e.g. "egg, whole".
//   onUpdateFood:  async (id, updates) => saved row (used to merge or to skip).
//   onSearchFoods: async (query) => USDA matches.
//   onFoodDetails: async (fdcId) => detail with per-100g nutrients.
//   onClose:       () => void. Called after apply/skip/dismiss.
export default function EnrichmentModal({ food, searchTerm, onUpdateFood, onSearchFoods, onFoodDetails, onClose }) {
  // 'loading' → auto-proposing · 'preview' → have a candidate · 'search' → manual
  // pick · 'empty' → auto found nothing to add · 'error'
  const [phase, setPhase] = useState('loading')
  const [preview, setPreview] = useState(null) // { added, nutrients, servingGrams, name }
  const [query, setQuery] = useState(searchTerm || food?.name || '')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Auto-propose from the best-matching generic on mount.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const term = (searchTerm || food?.name || '').trim()
        if (term.length < 2) {
          if (alive) setPhase('search')
          return
        }
        const rows = await onSearchFoods(term)
        const list = Array.isArray(rows) ? rows : []
        for (const r of list.slice(0, 5)) {
          const detail = await onFoodDetails(String(r.fdcId))
          const built = detail ? buildEnrichment(food, detail) : null
          if (built) {
            if (!alive) return
            setPreview({ ...built, name: r.name })
            setPhase('preview')
            return
          }
        }
        if (alive) setPhase('empty')
      } catch (err) {
        if (alive) {
          setError(err.message || 'Could not load a generic equivalent.')
          setPhase('error')
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [food, searchTerm, onSearchFoods, onFoodDetails])

  async function runSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    setError('')
    try {
      const rows = await onSearchFoods(q)
      setResults(Array.isArray(rows) ? rows.slice(0, 6) : [])
    } catch (err) {
      setError(err.message || 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function choose(r) {
    setBusy(true)
    setError('')
    try {
      const detail = await onFoodDetails(String(r.fdcId))
      const built = detail ? buildEnrichment(food, detail) : null
      if (!built) {
        setError(
          food?.serving_desc && /\d\s*g/i.test(food.serving_desc)
            ? 'That generic added no new micronutrients — this food already covers them.'
            : "I can't line up amounts because this food's serving isn't in grams. Close this, edit the food's serving to include a gram weight (e.g. \"2 eggs (100 g)\"), then try again."
        )
        return
      }
      setPreview({ ...built, name: r.name })
      setPhase('preview')
    } catch (err) {
      setError(err.message || 'Could not load that food.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!preview) return
    setBusy(true)
    try {
      await onUpdateFood(food.id, { nutrients: preview.nutrients })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try {
      // Remember the decision so re-opening/editing the food doesn't re-prompt.
      await onUpdateFood(food.id, { enrich_skipped: true })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!food) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Fill in micronutrients?</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200">{food.name}</span> lists only the
            nutrients on its label. I can borrow the rest (choline, magnesium, selenium…) from a generic USDA food,
            shown with a “borrowed” marker. Your label’s own numbers stay exactly as they are.
          </p>

          {phase === 'loading' && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Finding a generic equivalent…</p>
          )}

          {phase === 'error' && <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>}

          {phase === 'empty' && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              I couldn’t auto-match a generic that adds anything new. You can pick one yourself below, or skip.
            </p>
          )}

          {phase === 'preview' && preview && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                From <span className="font-medium">{preview.name}</span>, scaled to this food’s{' '}
                {preview.servingGrams} g serving, I’d add {preview.added.length} nutrient
                {preview.added.length === 1 ? '' : 's'}:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.added.map((a) => (
                  <span
                    key={a.id}
                    className="rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[11px] px-2 py-0.5"
                  >
                    {a.name} {Math.round(a.amount * 100) / 100}
                    {a.unit}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(phase === 'search' || phase === 'empty' || phase === 'preview') && (
            <details className="group" open={phase === 'search' || phase === 'empty'}>
              <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                {phase === 'preview' ? 'Pick a different food' : 'Search a generic food'}
              </summary>
              <form onSubmit={runSearch} className="mt-2 flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. “egg, whole”"
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button
                  type="submit"
                  disabled={searching || query.trim().length < 2}
                  className="rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 font-medium disabled:opacity-50"
                >
                  {searching ? '…' : 'Search'}
                </button>
              </form>
              {results && results.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">No matches — try different words.</p>
              )}
              {results && results.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {results.map((r) => (
                    <li key={r.fdcId}>
                      <button
                        onClick={() => choose(r)}
                        disabled={busy}
                        className="w-full text-left rounded-lg px-2 py-1 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        {r.name}
                        {r.brand ? ` (${r.brand})` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {error && phase !== 'error' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{error}</p>
              )}
            </details>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          {phase === 'preview' && (
            <button
              onClick={apply}
              disabled={busy}
              className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium py-2 transition disabled:opacity-50"
            >
              {busy ? 'Adding…' : `Add these ${preview ? preview.added.length : ''}`.trim()}
            </button>
          )}
          <button
            onClick={skip}
            disabled={busy}
            className="rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}
