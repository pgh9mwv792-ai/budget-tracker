import { useState } from 'react'
import { normalizeAliases } from '../lib/api'
import { urlDomain } from '../lib/webNutrition'
import { buildEnrichment, existingMicroIds } from '../lib/foodEnrich'
import { EstBadge } from './MealTracker'
import { gradeLabel, gradesForText, gradeById, nutrientsForGrade } from '../lib/gradeProfiles'

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
      ? 'bg-warning/15 text-warning'
      : source === 'web'
        ? 'bg-primary/10 text-interactive'
        : 'bg-border text-text-muted'
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
            className={`mt-0.5 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ›
          </span>
          <span className="min-w-0">
            <span className="block truncate text-text">
              {f.name}
              {f.serving_desc && <span className="text-text-muted"> · {f.serving_desc}</span>}
              {f.source === 'estimate' ? <EstBadge /> : <SourceBadge source={f.source} />}
              <GradeBadge grade={f.grade} />
            </span>
            {f.brand && (
              <span className="block truncate text-xs text-text-muted">{f.brand}</span>
            )}
            <span className="block text-xs text-text-muted">
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
                  ? 'text-interactive'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {f.is_stack ? '★ Stack' : '☆ Stack'}
            </button>
          )}
          <button
            onClick={() => onDeleteFood(f.id)}
            className="text-danger hover:text-danger text-xs"
          >
            Delete
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-3 pl-9 space-y-3">
          <ProvenanceLine food={f} enrichedCount={enrichedCount} />
          {onUpdateFood && <GradeEditor food={f} onUpdateFood={onUpdateFood} />}
          {onUpdateFood && <AliasEditor food={f} aliases={aliases} onUpdateFood={onUpdateFood} />}
          {onUpdateFood && onSearchFoods && onFoodDetails && f.source !== 'usda' && (
            <EnrichPanel food={f} onUpdateFood={onUpdateFood} onSearchFoods={onSearchFoods} onFoodDetails={onFoodDetails} />
          )}
        </div>
      )}
    </div>
  )
}

// The quality-grade chip on the collapsed row (grass-fed, wild, pasture-raised…).
function GradeBadge({ grade }) {
  const label = gradeLabel(grade)
  if (!label) return null
  return (
    <span className="ml-1.5 align-middle rounded px-1 py-px text-[10px] font-medium bg-primary/10 text-interactive">
      {label}
    </span>
  )
}

// Set / switch / clear a food's quality grade. Shown only for foods whose name
// belongs to a grade family. Switching re-derives the nutrients (a Tier-2 grade's
// cited micros are merged; a prior grade's overrides are stripped first), so the
// change is always reversible and never double-counts.
function GradeEditor({ food: f, onUpdateFood }) {
  const [busy, setBusy] = useState(false)
  const options = gradesForText(f.name)
  if (!options.length) return null

  async function pick(id) {
    const next = id === f.grade ? null : id
    setBusy(true)
    try {
      await onUpdateFood(f.id, { grade: next, nutrients: nutrientsForGrade(f, next) })
    } finally {
      setBusy(false)
    }
  }

  const activeTier = f.grade ? gradeById(f.grade)?.tier : null
  return (
    <div>
      <p className="text-xs font-medium text-text-muted mb-1">Quality grade</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((g) => {
          const on = g.id === f.grade
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => pick(g.id)}
              disabled={busy}
              className={`rounded-full px-2.5 py-1 text-xs font-medium border transition disabled:opacity-50 ${
                on
                  ? 'bg-primary border-primary text-on-primary'
                  : 'border-border text-text-muted hover:bg-bg'
              }`}
            >
              {g.label}
            </button>
          )
        })}
      </div>
      {f.grade && (
        <p className="text-[11px] text-text-muted mt-1">
          {activeTier === 2
            ? 'Cited nutrient values are applied to this food. Click the chip again to remove.'
            : 'Saved as a label — no nutrition change. Click the chip again to remove.'}
        </p>
      )}
    </div>
  )
}

function ProvenanceLine({ food: f, enrichedCount }) {
  const label = SOURCE_LABEL[f.source] ?? 'Manual entry'
  const domain = f.source_ref ? urlDomain(f.source_ref) : ''
  return (
    <p className="text-xs text-text-muted">
      Source: {label}
      {f.source === 'web' && f.source_ref && (
        <>
          {' — '}
          <a
            href={f.source_ref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-interactive hover:underline"
          >
            {domain || 'view source'}
          </a>
        </>
      )}
      {enrichedCount > 0 && (
        <span className="text-text-muted">
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
      <p className="text-xs font-medium text-text-muted mb-1">Quick-names</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {aliases.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-border text-text-muted text-xs px-2 py-0.5"
          >
            {a}
            <button
              onClick={() => remove(a)}
              disabled={busy}
              aria-label={`Remove quick-name ${a}`}
              className="text-text-muted hover:text-danger disabled:opacity-50"
            >
              ✕
            </button>
          </span>
        ))}
        {aliases.length === 0 && <span className="text-xs text-text-muted">None yet</span>}
      </div>
      <form onSubmit={add} className="mt-1.5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "eggs", "my protein"'
          disabled={busy}
          className="flex-1 rounded-lg border border-border bg-surface text-text px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-interactive/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs px-3 font-medium disabled:opacity-50"
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
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-xs font-medium text-text-muted">Fill in micronutrients from a generic equivalent</p>
      <p className="text-[11px] text-text-muted mt-0.5 mb-2">
        Borrows nutrients this label doesn’t list (choline, magnesium, etc.) from a generic USDA food. Your label’s own numbers stay as-is.
      </p>

      {!preview && (
        <>
          <form onSubmit={runSearch} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a generic food, e.g. “egg, whole”"
              className="flex-1 rounded-lg border border-border bg-surface text-text px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
            <button
              type="submit"
              disabled={searching || query.trim().length < 2}
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs px-3 font-medium disabled:opacity-50"
            >
              {searching ? '…' : 'Search'}
            </button>
          </form>
          {results && results.length === 0 && (
            <p className="text-xs text-text-muted mt-2">No matches — try different words.</p>
          )}
          {results && results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((r) => (
                <li key={r.fdcId}>
                  <button
                    onClick={() => choose(r)}
                    disabled={busy}
                    className="w-full text-left rounded-lg px-2 py-1 text-xs text-text hover:bg-bg disabled:opacity-50"
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
          <p className="text-xs text-text-muted">
            From <span className="font-medium">{preview.name}</span>, scaled to this food’s {preview.servingGrams} g serving,
            I’d add {preview.added.length} nutrient{preview.added.length === 1 ? '' : 's'}:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {preview.added.map((a) => (
              <span
                key={a.id}
                className="rounded-full bg-success/10 text-success text-[11px] px-2 py-0.5"
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
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs px-3 py-1 font-medium disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add these'}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={busy}
              className="rounded-lg border border-border text-text-muted text-xs px-3 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-warning mt-2">{error}</p>}
    </div>
  )
}
