import { useMemo, useState } from 'react'
import { micronutrientRows, nutrientContributors } from '../lib/micronutrients'
import { NUTRIENTS, defaultTargets } from '../lib/nutrients'
import ContributorDropdown from './ContributorDropdown'
import EnrichmentModal from './EnrichmentModal'

// Collapsible micronutrient tracker for the selected day. Sits below the macro
// targets on the Meals tab. Sums each food's canonical per-serving micros across
// the day's logs (see lib/micronutrients), shows a progress bar toward the RDA,
// turns the bar amber past the tolerable upper limit, and marks any nutrient the
// day's foods can't fully vouch for with "~" (coverage honesty).
//
// Props:
//   logs:        the selected day's food_logs.
//   foods:       the food library (to read normalized micros by food_id).
//   targets:     the nutrition_targets row ({ sex, micro_targets, ... }) or null.
//   onSetTargets: async (values) => save. Passes { microTargets, sex } through.
export default function MicronutrientSection({
  logs,
  foods,
  targets,
  onSetTargets,
  onUpdateFood,
  onSearchFoods,
  onFoodDetails,
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // The food a low-coverage "fix" tap is enriching, or null.
  const [enrichTarget, setEnrichTarget] = useState(null)

  const foodsById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods])
  const rows = useMemo(() => micronutrientRows(logs, foodsById, targets), [logs, foodsById, targets])

  // The low-coverage "fix" affordance is only wired when the enrichment callbacks
  // are present (they are on the Meals tab). Tapping a missing food opens the
  // same auto-enrichment modal used on save, resolved to its full library row.
  const canFix = !!(onUpdateFood && onSearchFoods && onFoodDetails)
  const onFix = canFix
    ? (f) => {
        const full = foodsById.get(f.foodId)
        if (full) setEnrichTarget(full)
      }
    : undefined

  const anyLogged = rows.some((r) => r.amount > 0)

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
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Micronutrients</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {anyLogged ? 'vitamins, minerals, fats & sugars today' : 'no micros logged yet'}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
          {editing ? (
            <MicroTargetsEditor
              targets={targets}
              onCancel={() => setEditing(false)}
              onSave={async (values) => {
                await onSetTargets(values)
                setEditing(false)
              }}
            />
          ) : (
            <>
              <div className="space-y-2.5">
                {rows.map((r) => (
                  <MicroRow key={r.id} row={r} logs={logs} foodsById={foodsById} onFix={onFix} />
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  “~” means few of today’s foods report that nutrient, so the total is likely an undercount.
                </p>
                <button
                  onClick={() => setEditing(true)}
                  className="shrink-0 ml-3 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  Edit targets
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {enrichTarget && (
        <EnrichmentModal
          food={enrichTarget}
          onUpdateFood={onUpdateFood}
          onSearchFoods={onSearchFoods}
          onFoodDetails={onFoodDetails}
          onClose={() => setEnrichTarget(null)}
        />
      )}
    </div>
  )
}

// One nutrient's bar. Two flavors:
//   • target nutrients (vitamins/minerals/fiber): bar fills toward the RDA,
//     turns emerald at 100%, amber past the tolerable upper limit.
//   • limit nutrients (saturated fat, cholesterol, added sugars): bar fills
//     toward the cap and turns amber once over it — reaching it isn't a "win",
//     so it never goes emerald.
// A "~" prefix flags low coverage; a nutrient with no reference just shows its
// running total (e.g. total sugars).
function MicroRow({ row, logs, foodsById, onFix }) {
  const { id, name, unit, amount, upperLimit, lowCoverage, overUL, kind, informational } = row
  const [open, setOpen] = useState(false)
  const shown = formatAmount(amount, unit)
  const isLimit = kind === 'limit'

  // The per-food breakdown is only computed when the row is actually expanded.
  const breakdown = useMemo(
    () => (open ? nutrientContributors(id, logs, foodsById) : null),
    [open, id, logs, foodsById]
  )

  const chevron = (
    <span
      className={`shrink-0 text-slate-300 dark:text-slate-600 transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      ›
    </span>
  )

  // Informational rollups (Omega-3 total, EPA+DHA) have no reference intake, so
  // they show just the running amount — no denominator, percent, or bar.
  const header = informational ? (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
        {chevron}
        {name}
      </span>
      <span className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">
        {lowCoverage && amount > 0 ? '~' : ''}
        {shown} {unit}
      </span>
    </div>
  ) : (
    <BarHeader
      row={row}
      shown={shown}
      isLimit={isLimit}
      chevron={chevron}
    />
  )

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
        aria-expanded={open}
      >
        {header}
      </button>
      {!informational && overUL && (
        <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
          Over the {isLimit ? 'recommended limit' : 'safe upper limit'} ({formatAmount(upperLimit, unit)} {unit}).
        </p>
      )}
      {open && breakdown && (
        <ContributorDropdown
          contributors={breakdown.contributors}
          notReported={breakdown.notReported}
          unit={unit}
          format={(n) => formatAmount(n, unit)}
          onFix={lowCoverage ? onFix : undefined}
        />
      )}
    </div>
  )
}

// The bar + numbers for a target/limit nutrient (the informational rollups skip
// this — they have no reference to measure against).
function BarHeader({ row, shown, isLimit, chevron }) {
  const { name, unit, amount, target, upperLimit, lowCoverage, overUL } = row
  // What the bar (and the "/ x" denominator) is measured against.
  const scale = isLimit ? upperLimit : target
  const pct = scale != null && scale > 0 ? (amount / scale) * 100 : 0
  const barPct = scale != null ? Math.min(100, pct) : amount > 0 ? 100 : 0
  const barColor = overUL
    ? 'bg-amber-500'
    : !isLimit && target != null && pct >= 100
      ? 'bg-emerald-500'
      : 'bg-sky-500'

  return (
    <>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          {chevron}
          {name}
        </span>
        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {lowCoverage && amount > 0 ? '~' : ''}
            {shown}
          </span>
          {scale != null ? ` / ${formatAmount(scale, unit)} ${unit}${isLimit ? ' max' : ''}` : ` ${unit}`}
          {scale != null && (
            <span className={`ml-1 ${overUL ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
              {Math.round(pct)}%
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${barPct}%` }} />
      </div>
    </>
  )
}

// Compact numeric formatting: micrograms/milligrams get sensible precision.
function formatAmount(n, unit) {
  const v = Number(n) || 0
  if (v === 0) return '0'
  if (v >= 100) return String(Math.round(v))
  if (v >= 10) return v.toFixed(0)
  if (v >= 1) return v.toFixed(1)
  return v.toFixed(unit === 'mcg' ? 1 : 2)
}

// Inline editor: pick the biological-sex cohort (drives the default RDAs/ULs)
// and override any nutrient's target/upper limit. Blank = use the default.
function MicroTargetsEditor({ targets, onCancel, onSave }) {
  const [sex, setSex] = useState(targets?.sex ?? 'neutral')
  // Seed the fields from the user's existing overrides only — placeholders show
  // the current default so a blank field visibly means "use the default".
  const [overrides, setOverrides] = useState(() => {
    const seed = {}
    const existing = targets?.micro_targets ?? {}
    for (const n of NUTRIENTS) {
      const o = existing[n.id]
      seed[n.id] = {
        target: o && o.target != null ? String(o.target) : '',
        upper_limit: o && o.upper_limit != null ? String(o.upper_limit) : '',
      }
    }
    return seed
  })
  const [saving, setSaving] = useState(false)

  // Placeholders track the chosen cohort so switching sex re-hints the defaults.
  const defaults = useMemo(() => defaultTargets(sex), [sex])

  const setField = (id, field) => (e) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], [field]: e.target.value } }))

  const resetOne = (id) => setOverrides((o) => ({ ...o, [id]: { target: '', upper_limit: '' } }))

  const resetAll = () =>
    setOverrides(() => {
      const cleared = {}
      for (const n of NUTRIENTS) cleared[n.id] = { target: '', upper_limit: '' }
      return cleared
    })

  const save = async () => {
    // Only persist nutrients the user actually customized; everything else falls
    // back to the cohort default at read time (keeps the stored map small).
    const microTargets = {}
    for (const n of NUTRIENTS) {
      const o = overrides[n.id]
      const t = o.target.trim() === '' ? null : Number(o.target)
      const u = o.upper_limit.trim() === '' ? null : Number(o.upper_limit)
      if (t != null || u != null) microTargets[n.id] = { target: t, upper_limit: u }
    }
    setSaving(true)
    await onSave({ microTargets, sex })
    setSaving(false)
  }

  const field =
    'w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
          Reference cohort (sets default RDAs)
        </span>
        <div className="flex gap-2">
          {[
            { key: 'male', label: 'Male' },
            { key: 'female', label: 'Female' },
            { key: 'neutral', label: 'Average' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSex(opt.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                sex === opt.key
                  ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                  : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1.5">
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Nutrient</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-right">Target</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-right">Max (UL)</span>
        <span />
        {NUTRIENTS.map((n) => (
          <MicroTargetFieldRow
            key={n.id}
            nutrient={n}
            values={overrides[n.id]}
            def={defaults[n.id]}
            onTarget={setField(n.id, 'target')}
            onUpper={setField(n.id, 'upper_limit')}
            onReset={() => resetOne(n.id)}
            field={field}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={resetAll}
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          Reset all to defaults
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="text-xs rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 font-medium transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save targets'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MicroTargetFieldRow({ nutrient, values, def, onTarget, onUpper, onReset, field }) {
  const customized = values.target.trim() !== '' || values.upper_limit.trim() !== ''
  return (
    <>
      <span className="text-xs text-slate-600 dark:text-slate-300 truncate" title={nutrient.name}>
        {nutrient.name} <span className="text-slate-400 dark:text-slate-500">({nutrient.unit})</span>
      </span>
      <input
        type="number"
        min="0"
        step="any"
        value={values.target}
        onChange={onTarget}
        placeholder={def?.target != null ? String(def.target) : '—'}
        className={`w-16 text-right ${field}`}
      />
      <input
        type="number"
        min="0"
        step="any"
        value={values.upper_limit}
        onChange={onUpper}
        placeholder={def?.upper_limit != null ? String(def.upper_limit) : '—'}
        className={`w-16 text-right ${field}`}
      />
      <button
        type="button"
        onClick={onReset}
        disabled={!customized}
        title="Reset to default"
        className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 px-1"
      >
        ↺
      </button>
    </>
  )
}
