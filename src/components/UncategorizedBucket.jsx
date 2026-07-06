export default function UncategorizedBucket({ transactions, categories, onAssign, onApplyRules, savedMatchCount = 0 }) {
  // Transfers (e.g. savings -> checking) aren't spending or income, so they
  // don't need a category — leave them out of the "needs categorizing" list.
  const uncategorized = transactions.filter((t) => !t.category_id && t.kind !== 'transfer')

  if (uncategorized.length === 0) return null

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Uncategorized ({uncategorized.length}) — mostly from Plaid imports
        </h3>
        {savedMatchCount > 0 && (
          <button
            onClick={onApplyRules}
            className="shrink-0 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium px-2.5 py-1 transition"
          >
            Auto-categorize {savedMatchCount} with saved rules
          </button>
        )}
      </div>
      <div className="space-y-2">
        {uncategorized.map((t) => (
          <div key={t.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 rounded-md px-3 py-2 text-sm">
            <div className="flex items-center gap-4 min-w-0">
              <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">{t.date}</span>
              <span className={`w-20 shrink-0 font-medium ${t.kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {t.kind === 'income' ? '+' : '-'}${Number(t.amount).toFixed(2)}
              </span>
              <span className="text-slate-400 dark:text-slate-500 truncate">{t.note}</span>
            </div>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && onAssign(t.id, e.target.value)}
              className="w-full sm:w-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-2 sm:py-1 text-sm shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="" disabled>
                Assign category…
              </option>
              {categories
                .filter((c) => c.kind === t.kind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
