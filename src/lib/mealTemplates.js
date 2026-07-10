// Meal templates ("my usual breakfast") — pure helpers, no I/O.
//
// A template is a saved bundle of food snapshots the user eats repeatedly. Each
// item mirrors a food_log's per-serving numbers so the template stays stable
// even if the underlying library food is later edited or deleted:
//   { food_id, name, servings, calories, protein, carbs, fat, cost }
// Totals multiply each item's per-serving macro by its servings, exactly like
// the meal tracker's day totals.
//
// The scheduling side is deliberately confirmation-first: plannedTemplatesFor
// Date only tells the UI which templates *could* be logged today; nothing here
// writes anything. Auto-logging is a separate opt-in flag surfaced to the caller.

// Weekday number (0=Sunday … 6=Saturday) for a YYYY-MM-DD date, timezone-safe
// (anchored at noon UTC so it never slips a day across zones).
export function weekdayOf(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

// Sum a template's items into a single macro/cost total, honoring per-item
// servings. Missing numbers count as zero; a null cost contributes nothing.
export function templateTotals(items) {
  return (items || []).reduce(
    (acc, it) => {
      const s = Number(it.servings) || 0
      acc.calories += (Number(it.calories) || 0) * s
      acc.protein += (Number(it.protein) || 0) * s
      acc.carbs += (Number(it.carbs) || 0) * s
      acc.fat += (Number(it.fat) || 0) * s
      acc.cost += (it.cost == null ? 0 : Number(it.cost) || 0) * s
      return acc
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, cost: 0 }
  )
}

// Build a template's `items` array from a set of food logs (e.g. "save today's
// breakfast as a template"). Keeps each log's own per-serving snapshot so the
// template is self-contained.
export function itemsFromLogs(logs) {
  return (logs || []).map((l) => ({
    food_id: l.food_id ?? l.foodId ?? null,
    name: l.name,
    servings: Number(l.servings) || 1,
    calories: Number(l.calories) || 0,
    protein: Number(l.protein) || 0,
    carbs: Number(l.carbs) || 0,
    fat: Number(l.fat) || 0,
    cost: l.cost == null ? null : Number(l.cost),
  }))
}

// Normalize a string for name matching: lowercase, strip filler words the user
// naturally says ("my", "usual", "the"), collapse whitespace.
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(my|the|a|usual|regular|go[- ]?to)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Resolve a template the user named in words (for the assistant). Returns
// { match, candidates }:
//   - exact/normalized-equal name → { match: template, candidates: [it] }
//   - one substring hit → that template
//   - several substring hits → { match: null, candidates: [...] } so the caller
//     can ask which one
//   - nothing → { match: null, candidates: [] }
export function resolveTemplateByName(templates, name) {
  const list = templates || []
  const q = normalizeName(name)
  if (!q) return { match: null, candidates: [] }

  const normalized = list.map((t) => ({ t, n: normalizeName(t.name) }))

  const exact = normalized.filter((x) => x.n === q)
  if (exact.length === 1) return { match: exact[0].t, candidates: [exact[0].t] }
  if (exact.length > 1) return { match: null, candidates: exact.map((x) => x.t) }

  const partial = normalized.filter((x) => x.n.includes(q) || q.includes(x.n))
  if (partial.length === 1) return { match: partial[0].t, candidates: [partial[0].t] }
  return { match: null, candidates: partial.map((x) => x.t) }
}

// Which templates are "planned" for a given date: scheduled on that weekday, in
// created order. Each result is annotated with whether it's already been logged
// that day (so the card can hide/mark itself) and whether auto-log is opted in.
// `logs` is the full food_logs list; a template counts as logged when any log on
// that date carries its template_id.
export function plannedTemplatesForDate(templates, logs, date) {
  const wd = weekdayOf(date)
  const loggedTemplateIds = new Set(
    (logs || [])
      .filter((l) => l.date === date && (l.template_id ?? l.templateId))
      .map((l) => l.template_id ?? l.templateId)
  )
  return (templates || [])
    .filter((t) => Array.isArray(t.scheduled_days) && t.scheduled_days.includes(wd))
    .map((t) => ({
      template: t,
      alreadyLogged: loggedTemplateIds.has(t.id),
      autoLog: !!t.auto_log,
    }))
}
