// Expandable "who contributed this?" panel shared by macro and micronutrient
// rows. Pure presentation — the caller passes a precomputed breakdown from
// macroContributors / nutrientContributors (lib), so this only renders.
//
// Props:
//   contributors: [{ foodId, name, amount, pct, markers }] sorted desc.
//   notReported:  [{ foodId, name }] logged foods lacking the nutrient (micros
//                 only; omit/empty for macros, which are always reported).
//   unit:         display unit appended to each amount.
//   format:       (amount) => string, number formatter matching the row.
//   onFix:        optional (food) => void — a one-tap enrichment entry for a
//                 food in `notReported` (used by the low-coverage fix flow).
export default function ContributorDropdown({ contributors, notReported = [], unit, format, onFix }) {
  const fmt = format ?? ((n) => String(Math.round((Number(n) || 0) * 100) / 100))
  return (
    <div className="mt-1.5 rounded-lg bg-bg px-3 py-2 space-y-1.5">
      {contributors.length === 0 ? (
        <p className="text-xs text-text-muted">Nothing logged contributes this yet.</p>
      ) : (
        <ul className="space-y-1">
          {contributors.map((c) => (
            <li key={c.foodId ?? c.name} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-text-muted">
                {c.name}
                <FormLabel form={c.form} />
                <Markers markers={c.markers} />
              </span>
              <span className="shrink-0 tabular-nums text-text-muted">
                <span className="font-medium text-text">
                  {fmt(c.amount)} {unit}
                </span>
                <span className="ml-1 text-text-muted">{Math.round(c.pct)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {notReported.length > 0 && (
        <div className="pt-1 border-t border-border">
          <p className="text-[11px] text-text-muted">Not reported by:</p>
          <ul className="mt-0.5 flex flex-wrap gap-1.5">
            {notReported.map((f) => (
              <li key={f.foodId ?? f.name}>
                {onFix ? (
                  <button
                    type="button"
                    onClick={() => onFix(f)}
                    title={`Fill in this nutrient for ${f.name} from a generic equivalent`}
                    className="rounded-full bg-surface border border-border text-text-muted text-[11px] px-2 py-0.5 hover:border-interactive hover:text-interactive transition"
                  >
                    {f.name} · fix
                  </button>
                ) : (
                  <span className="rounded-full bg-surface text-text-muted text-[11px] px-2 py-0.5">
                    {f.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Vitamin A form label: names whether a contributor's vitamin A is preformed
// retinol (from animals) or beta-carotene (from plants, which the body converts
// far less efficiently). Education only — the RAE total already accounts for the
// conversion. Absent for foods that report no retinol/carotene breakdown.
const VIT_A_FORM_LABEL = {
  preformed: 'retinol (preformed)',
  plant: 'beta-carotene (from plants)',
  mixed: 'retinol + beta-carotene',
}
function FormLabel({ form }) {
  const label = VIT_A_FORM_LABEL[form]
  if (!label) return null
  return (
    <span className="ml-1 align-middle text-[10px] text-text-muted">· {label}</span>
  )
}

// Small provenance chips inside a contributor row so a borrowed/estimated/
// profile-derived value stays honest about where it came from.
function Markers({ markers }) {
  if (!markers) return null
  return (
    <>
      {markers.estimate && <Chip title="Macros are an estimate">est.</Chip>}
      {markers.borrowed && <Chip title="Borrowed from a generic USDA equivalent">~</Chip>}
      {markers.profile && <Chip title="From the food's selected grade profile">grade</Chip>}
    </>
  )
}

function Chip({ children, title }) {
  return (
    <span
      title={title}
      className="ml-1 align-middle rounded px-1 text-[9px] font-medium bg-border text-text-muted"
    >
      {children}
    </span>
  )
}
