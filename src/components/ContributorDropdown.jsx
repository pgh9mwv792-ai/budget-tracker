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
    <div className="mt-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 space-y-1.5">
      {contributors.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Nothing logged contributes this yet.</p>
      ) : (
        <ul className="space-y-1">
          {contributors.map((c) => (
            <li key={c.foodId ?? c.name} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                {c.name}
                <Markers markers={c.markers} />
              </span>
              <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {fmt(c.amount)} {unit}
                </span>
                <span className="ml-1 text-slate-400 dark:text-slate-500">{Math.round(c.pct)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {notReported.length > 0 && (
        <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Not reported by:</p>
          <ul className="mt-0.5 flex flex-wrap gap-1.5">
            {notReported.map((f) => (
              <li key={f.foodId ?? f.name}>
                {onFix ? (
                  <button
                    type="button"
                    onClick={() => onFix(f)}
                    title={`Fill in this nutrient for ${f.name} from a generic equivalent`}
                    className="rounded-full bg-white dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 text-[11px] px-2 py-0.5 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 transition"
                  >
                    {f.name} · fix
                  </button>
                ) : (
                  <span className="rounded-full bg-white/60 dark:bg-slate-700/40 text-slate-400 dark:text-slate-500 text-[11px] px-2 py-0.5">
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
      className="ml-1 align-middle rounded px-1 text-[9px] font-medium bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
    >
      {children}
    </span>
  )
}
