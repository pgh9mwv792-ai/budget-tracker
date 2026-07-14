// One stable color + label per macro, defined once and reused across the app
// (targets header bars, meal summaries, food previews) so a macro always reads
// the same color. These are Tailwind class strings rendered directly in JSX
// (MealTracker's macro bars/summaries), so they use the app's semantic color
// tokens — each macro gets a distinct token that reads on-theme in light and
// dark, and none of them appears as an adjacent chart segment to another, so the
// dark-mode primary/chart-2/interactive collisions don't apply here. Past 100%
// of target a bar switches to OVER_BAR (the app's over color).

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat']

export const MACRO_META = {
  calories: {
    label: 'Energy',
    unit: 'kcal',
    bar: 'bg-warning',
    text: 'text-warning',
  },
  protein: {
    label: 'Protein',
    unit: 'g',
    bar: 'bg-success',
    text: 'text-success',
  },
  carbs: {
    label: 'Carbs',
    unit: 'g',
    bar: 'bg-interactive',
    text: 'text-interactive',
  },
  fat: {
    label: 'Fat',
    unit: 'g',
    bar: 'bg-chart-1',
    text: 'text-chart-1',
  },
}

// The app's warning/over color — a macro bar turns this once it passes target.
export const OVER_BAR = 'bg-danger'

// Per-food breakdown of one macro for the day, for the contributor dropdown.
// Macros live on the log itself (log.protein × servings, etc.) and are always
// reported, so there's no "not reported" list — every logged food contributes.
//   macroKey:  'calories' | 'protein' | 'carbs' | 'fat'
//   logs:      the day's food_logs.
//   foodsById: optional Map, only used to surface the "est." marker for logs
//              whose food is an assistant estimate (source === 'estimate').
// Returns { total, contributors: [{ foodId, name, amount, pct, markers }] } sorted
// descending by amount. Pure — the component only renders it.
export function macroContributors(macroKey, logs, foodsById) {
  const byFood = new Map()
  for (const log of logs ?? []) {
    const servings = Number(log?.servings) || 0
    const amount = (Number(log?.[macroKey]) || 0) * servings
    if (amount <= 0) continue
    // Group by library food when known, else by name (hand-typed one-off logs).
    const key = log.food_id != null ? `id:${log.food_id}` : `name:${String(log.name ?? '').toLowerCase()}`
    const food = log.food_id != null ? foodsById?.get(log.food_id) : null
    const prev = byFood.get(key)
    if (prev) prev.amount += amount
    else
      byFood.set(key, {
        foodId: log.food_id ?? null,
        name: log.name ?? food?.name ?? 'Food',
        amount,
        markers: { estimate: food?.source === 'estimate' },
      })
  }
  const contributors = [...byFood.values()].sort((a, b) => b.amount - a.amount)
  const total = contributors.reduce((s, c) => s + c.amount, 0)
  for (const c of contributors) c.pct = total > 0 ? (c.amount / total) * 100 : 0
  return { total, contributors }
}
