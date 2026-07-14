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

  // Header state tracks whether the day has any logged foods — NOT whether any
  // micro row is non-zero. A day with foods that simply don't report micros
  // still has rows below, so "no micros logged yet" would contradict them.
  const anyLogged = logs.length > 0

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className={`text-text-muted transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
        <span className="text-sm font-semibold text-text">Micronutrients</span>
        <span className="text-xs text-text-muted">
          {anyLogged ? 'vitamins, minerals, fats & sugars today' : 'no micros logged yet'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-4 space-y-3">
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
              <div className="flex items-center justify-between border-t border-border pt-3">
                <p className="text-xs text-text-muted">
                  “~” means few of today’s foods report that nutrient, so the total is likely an undercount.
                </p>
                <button
                  onClick={() => setEditing(true)}
                  className="shrink-0 ml-3 text-xs text-text-muted hover:text-text"
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
//     turns success at 100%, warning past the tolerable upper limit.
//   • limit nutrients (saturated fat, cholesterol, added sugars): bar fills
//     toward the cap and turns warning once over it — reaching it isn't a "win",
//     so it never goes success.
// A "~" prefix flags low coverage; a nutrient with no reference just shows its
// running total (e.g. total sugars).
function MicroRow({ row, logs, foodsById, onFix }) {
  const { id, name, unit, amount, upperLimit, lowCoverage, overUL, kind, informational } = row
  const { omegaRole, subtitle, reference, groupNote } = row
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
      className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      ›
    </span>
  )

  // Informational rollups (Omega-3 total, EPA+DHA) have no reference intake, so
  // they show just the running amount — no denominator, percent, or bar.
  const header = informational ? (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-text-muted">
        {chevron}
        {name}
      </span>
      <span className="tabular-nums font-semibold text-text">
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
    <div className={omegaRole === 'secondary' ? 'ml-4 pl-2 border-l border-border' : ''}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
        aria-expanded={open}
      >
        {header}
      </button>
      {/* Omega-3 form hints: EPA+DHA "preformed", ALA "converts poorly". */}
      {subtitle && (
        <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>
      )}
      {reference && (
        <p className="text-[11px] text-text-muted">{reference}</p>
      )}
      {!informational && overUL && (
        <p className="mt-0.5 text-[11px] text-warning">
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
      {groupNote && (
        <p className="mt-1.5 text-[11px] italic text-text-muted">{groupNote}</p>
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
    ? 'bg-warning'
    : !isLimit && target != null && pct >= 100
      ? 'bg-success'
      : 'bg-interactive'

  return (
    <>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-text-muted">
          {chevron}
          {name}
        </span>
        <span className="text-text-muted tabular-nums">
          <span className="font-semibold text-text">
            {lowCoverage && amount > 0 ? '~' : ''}
            {shown}
          </span>
          {scale != null ? ` / ${formatAmount(scale, unit)} ${unit}${isLimit ? ' max' : ''}` : ` ${unit}`}
          {scale != null && (
            <span className={`ml-1 ${overUL ? 'text-warning' : 'text-text-muted'}`}>
              {Math.round(pct)}%
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-border overflow-hidden">
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
    'w-full rounded-md border border-border bg-surface text-text px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-interactive/40'

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-xs font-medium text-text-muted mb-1">
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
                  ? 'bg-primary text-on-primary'
                  : 'border border-border text-text-muted hover:bg-bg'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1.5">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Nutrient</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted text-right">Target</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted text-right">Max (UL)</span>
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
          className="text-xs text-text-muted hover:text-text"
        >
          Reset all to defaults
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-text-muted hover:text-text px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="text-xs rounded-full bg-primary hover:bg-primary-hover text-on-primary px-4 py-1.5 font-medium transition disabled:opacity-50"
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
      <span className="text-xs text-text-muted truncate" title={nutrient.name}>
        {nutrient.name} <span className="text-text-muted">({nutrient.unit})</span>
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
        className="text-xs text-text-muted hover:text-text disabled:opacity-30 px-1"
      >
        ↺
      </button>
    </>
  )
}
