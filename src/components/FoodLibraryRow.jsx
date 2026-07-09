import { useState } from 'react'
import { normalizeAliases } from '../lib/api'
import { urlDomain } from '../lib/webNutrition'
import { buildEnrichment, existingMicroIds } from '../lib/foodEnrich'
import { EstBadge } from './MealTracker'

// Human-readable provenance for a food's `source`, so every tier (hand-entered,
// USDA, a scanned label, a web lookup, an estimate) is visible at a glance.
const SOURCE_LABEL = {
  manual: 'Manual entry',
  usda: 'USDA database',
  supplement_scan: 'Scanned supplement label',
  receipt: 'From a receipt',
  estimate: 'Estimated chain item',
  label_scan: 'Scanned Nutrition Facts label',
  web: 'Web lookup',
}

function SourceBadge({ source }) {
  if (!source || source === 'manual') return null
  const label = SOURCE_LABEL[source] ?? source
  const tone =
    source === 'estimate'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
      : source === 'web'
        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`ml-1.5 align-middle rounded px-1 py-px text-[10px] font-medium ${tone}`}>{label}</span>
  )
}

// One row of the food library. Collapsed it shows name + macros; expanded it
// reveals provenance (source + web source URL), the quick-name aliases (editable),
// and the micronutrient-enrichment action for branded/label/web foods.
export default function FoodLibraryRow({ food: f, onDeleteFood, onUpdateFood, onSearchFoods, onFoodDetails }) {
  const [open, setOpen] = useState(false)
  const aliases = Array.isArray(f.aliases) ? f.aliases : []
  const microCount = existingMicroIds(f).size
  const enrichedCount = (Array.isArray(f.nutrients) ? f.nutrients : []).filter(
    (e) => e && e.id && e.enriched_from
  ).length

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-start gap-2 min-w-0 text-left flex-1"
          aria-expanded={open}
        >
          <span
            className={`mt-0.5 text-slate-400 dark:text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ›
          </span>
          <span className="min-w-0">
            <span className="block truncate text-slate-700 dark:text-slate-200">
              {f.name}
              {f.serving_desc && <span className="text-slate-400 dark:text-slate-500"> · {f.serving_desc}</span>}
              {f.source === 'estimate' ? <EstBadge /> : <SourceBadge source={f.source} />}
            </span>
            <span className="block text-xs text-slate-400 dark:text-slate-500">
              {Math.round(Number(f.calories))} cal · {Math.round(Number(f.protein))}g P · {Math.round(Number(f.carbs))}g C ·{' '}
              {Math.round(Number(f.fat))}g F
              {f.cost != null && ` · $${Number(f.cost).toFixed(2)}`}
              {microCount > 0 && ` · ${microCount} micros`}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {onUpdateFood && (
            <button
              onClick={() => onUpdateFood(f.id, { is_stack: !f.is_stack })}
              title={f.is_stack ? 'In your daily stack — click to remove' : 'Add to your daily stack'}
              className={`text-xs ${
                f.is_stack
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {f.is_stack ? '★ Stack' : '☆ Stack'}
            </button>
          )}
          <button
            onClick={() => onDeleteFood(f.id)}
            className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs"
          >
            Delete
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-3 pl-9 space-y-3">
          <ProvenanceLine food={f} enrichedCount={enrichedCount} />
          {onUpdateFood && <AliasEditor food={f} aliases={aliases} onUpdateFood={onUpdateFood} />}
          {onUpdateFood && onSearchFoods && onFoodDetails && f.source !== 'usda' && (
            <EnrichPanel food={f} onUpdateFood={onUpdateFood} onSearchFoods={onSearchFoods} onFoodDetails={onFoodDetails} />
          )}
        </div>
      )}
    </div>
  )
}

function ProvenanceLine({ food: f, enrichedCount }) {
  const label = SOURCE_LABEL[f.source] ?? 'Manual entry'
  const domain = f.source_ref ? urlDomain(f.source_ref) : ''
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      Source: {label}
      {f.source === 'web' && f.source_ref && (
        <>
          {' — '}
          <a
            href={f.source_ref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-600 dark:text-sky-400 hover:underline"
          >
            {domain || 'view source'}
          </a>
        </>
      )}
      {enrichedCount > 0 && (
        <span className="text-slate-400 dark:text-slate-500">
          {' · '}
          {enrichedCount} micronutrient{enrichedCount === 1 ? '' : 's'} from a generic equivalent
        </span>
      )}
    </p>
  )
}

// Add/remove short quick-names ("eggs") the assistant and search resolve on.
function AliasEditor({ food: f, aliases, onUpdateFood }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function commit(next) {
    setBusy(true)
    try {
      await onUpdateFood(f.id, { aliases: normalizeAliases(next) })
    } finally {
      setBusy(false)
    }
  }
  async function add(e) {
    e.preventDefault()
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    setText('')
    await commit([...aliases, ...parts])
  }
  async function remove(a) {
    await commit(aliases.filter((x) => x !== a))
  }

  return (
    <div>
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Quick-names</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {aliases.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs px-2 py-0.5"
          >
            {a}
            <button
              onClick={() => remove(a)}
              disabled={busy}
              aria-label={`Remove quick-name ${a}`}
              className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
            >
              ✕
            </button>
          </span>
        ))}
        {aliases.length === 0 && <span className="text-xs text-slate-400 dark:text-slate-500">None yet</span>}
      </div>
      <form onSubmit={add} className="mt-1.5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "eggs", "my protein"'
          disabled={busy}
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 font-medium disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  )
}

// "Borrow the rest of the micronutrient profile from a generic USDA food."
// Searches USDA, previews only the nutrients this food is MISSING, and on
// confirm merges them (tagged enriched_from) without touching the label numbers.
function EnrichPanel({ food: f, onUpdateFood, onSearchFoods, onFoodDetails }) {
  const [query, setQuery] = useState(f.name || '')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [preview, setPreview] = useState(null) // { added, nutrients, servingGrams, name }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function runSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    setError('')
    setPreview(null)
    try {
      const rows = await onSearchFoods(q)
      setResults(Array.isArray(rows) ? rows.slice(0, 5) : [])
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
      const built = detail ? buildEnrichment(f, detail) : null
      if (!built) {
        setError(
          f.serving_desc && /\d\s*g/i.test(f.serving_desc)
            ? 'That generic added no new micronutrients — this food already covers them.'
            : "I can't line up amounts because this food's serving isn't in grams. Edit the serving to include a gram weight (e.g. \"1 bar (60 g)\") first."
        )
        return
      }
      setPreview({ ...built, name: r.name })
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
      await onUpdateFood(f.id, { nutrients: preview.nutrients })
      setPreview(null)
      setResults(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Fill in micronutrients from a generic equivalent</p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 mb-2">
        Borrows nutrients this label doesn’t list (choline, magnesium, etc.) from a generic USDA food. Your label’s own numbers stay as-is.
      </p>

      {!preview && (
        <>
          <form onSubmit={runSearch} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a generic food, e.g. “egg, whole”"
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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
        </>
      )}

      {preview && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            From <span className="font-medium">{preview.name}</span>, scaled to this food’s {preview.servingGrams} g serving,
            I’d add {preview.added.length} nutrient{preview.added.length === 1 ? '' : 's'}:
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
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={apply}
              disabled={busy}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1 font-medium disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add these'}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={busy}
              className="rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs px-3 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{error}</p>}
    </div>
  )
}
