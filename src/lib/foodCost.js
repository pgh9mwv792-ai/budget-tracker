import { monthKey, addDays } from './dateHelpers'

// ---------------------------------------------------------------------------
// Food-cost intelligence. Pure, deterministic functions (pass `today` so they
// stay testable and don't surprise you around midnight) that turn the raw
// transactions + food_logs + foods + nutrition_targets into the money+food
// story the dashboard now leads with.
//
// Two data sources feed this:
//   • transactions — what you actually SPENT on food (grocery vs. restaurant),
//     classified from the category name, the merchant note, and — if it's ever
//     present on an imported row — Plaid's personal_finance_category.
//   • food_logs / foods — what you actually ATE (protein) and its logged cost,
//     which is what powers cost-per-protein and the protein-value ranking.
//
// Everything degrades gracefully: thin or missing data returns hasData:false
// and coverage numbers rather than throwing or reporting a misleading value.
// ---------------------------------------------------------------------------

// Merchant / category keyword rules. Category name is the most reliable signal
// (the user controls it), the merchant note is the fallback for uncategorized
// imports, and the Plaid category is a last resort when present.
const GROCERY_RE =
  /grocer|supermarket|whole foods|trader joe|safeway|kroger|aldi|costco|wegmans|publix|food lion|sprouts|market basket/i
const RESTAURANT_RE =
  /dining|restaurant|takeout|take-?out|fast food|coffee|cafe|chipotle|mcdonald|starbucks|doordash|uber ?eats|grubhub|pizza|taco|burger|sushi|deli|diner|panera|subway|wendy|blue bottle|bar & grill/i
// A catch-all "this is food" signal for spending that's food but not clearly
// grocery vs. restaurant (counts toward the total, sits outside the split).
const FOOD_GENERIC_RE = /\bfood\b|meal|snack|smoothie|supplement|\beat\b/i

// Classify one expense transaction as 'grocery' | 'restaurant' | 'food' | null.
export function classifyFoodTxn(t) {
  const catName = t?.category?.name ?? ''
  const note = t?.note ?? ''
  // personal_finance_category may be a Plaid object ({primary}) or a string, or
  // (in this app's current schema) simply absent — handle all three.
  const pfcRaw = t?.personal_finance_category
  const pfc = (typeof pfcRaw === 'string' ? pfcRaw : pfcRaw?.primary) ?? ''

  if (GROCERY_RE.test(catName) || GROCERY_RE.test(note) || /GROCER/i.test(pfc)) return 'grocery'
  if (
    RESTAURANT_RE.test(catName) ||
    RESTAURANT_RE.test(note) ||
    /RESTAURANT|FAST_FOOD|COFFEE|FOOD_AND_DRINK/i.test(pfc)
  )
    return 'restaurant'
  if (FOOD_GENERIC_RE.test(catName) || FOOD_GENERIC_RE.test(note)) return 'food'
  return null
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

// Number of days in the calendar month containing `dateStr` ('YYYY-MM-DD').
function daysInMonthOf(dateStr) {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// The trailing N full calendar-month keys BEFORE the month of `today`, oldest
// first (e.g. today in July → ['2026-04','2026-05','2026-06'] for n=3).
function prevMonthKeys(today, n) {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  const keys = []
  for (let i = n; i >= 1; i--) {
    const d = new Date(y, m - 1 - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

// -----------------------------------------------------------------------------
// costPerDay(range): total food SPEND per day over the trailing `days` window,
// split grocery vs. restaurant. Money spent, not calories eaten.
// -----------------------------------------------------------------------------
export function costPerDay(transactions = [], { today = isoToday(), days = 30 } = {}) {
  const start = addDays(today, -(days - 1))
  let grocery = 0
  let restaurant = 0
  let other = 0
  let txnCount = 0

  for (const t of transactions) {
    if (t.kind !== 'expense') continue
    if (t.date < start || t.date > today) continue
    const cls = classifyFoodTxn(t)
    if (!cls) continue
    const amt = Number(t.amount) || 0
    if (cls === 'grocery') grocery += amt
    else if (cls === 'restaurant') restaurant += amt
    else other += amt
    txnCount++
  }

  const total = grocery + restaurant + other
  const restaurantShare = total > 0 ? restaurant / total : null

  return {
    days,
    start,
    today,
    grocery,
    restaurant,
    other,
    total,
    perDay: total / days,
    groceryPerDay: grocery / days,
    restaurantPerDay: restaurant / days,
    restaurantShare, // fraction of food spend that was eating out (null if none)
    txnCount,
    hasData: txnCount > 0,
  }
}

// -----------------------------------------------------------------------------
// costPerProtein(range): dollars per gram of protein actually LOGGED over the
// window. Uses only meals that carry a cost so the ratio is honest, and reports
// coverage (% of logged meals that had a cost) so the UI can qualify it.
//
// This is the log-side food-cost total: it sums each log's own `cost` exactly
// once — a restaurant meal (the assistant stamps it with the bank charge) and a
// home meal (a library food's snapshot cost) sit side by side here. `l.cost` is
// the per-log snapshot and is authoritative, so a food that also carries a
// library default cost is NOT double-counted: the log's cost wins.
//
// A log linked to a transaction (l.transaction_id) is money ALSO present in the
// transaction-spend total (costPerDay / monthlyFoodBurn). These two totals are
// intentionally separate views — never sum a log's cost onto its own linked
// transaction, or that dollar counts twice.
// -----------------------------------------------------------------------------
export function costPerProtein(foodLogs = [], { today = isoToday(), days = 30 } = {}) {
  const start = addDays(today, -(days - 1))
  const inRange = foodLogs.filter((l) => l.date >= start && l.date <= today)

  let cost = 0
  let proteinWithCost = 0
  let mealsWithCost = 0
  let totalProtein = 0

  for (const l of inRange) {
    const s = Number(l.servings) || 0
    const protein = (Number(l.protein) || 0) * s
    totalProtein += protein
    if (l.cost != null && l.cost !== '') {
      cost += (Number(l.cost) || 0) * s
      proteinWithCost += protein
      mealsWithCost++
    }
  }

  const meals = inRange.length
  const coverage = meals > 0 ? mealsWithCost / meals : null
  const costPerGram = proteinWithCost > 0 ? cost / proteinWithCost : null

  return {
    days,
    meals,
    mealsWithCost,
    coverage, // fraction of logged meals that had a cost (null if none logged)
    protein: proteinWithCost,
    totalProtein,
    cost,
    costPerGram, // dollars per gram of protein (null if no priced protein)
    costPer100g: costPerGram == null ? null : costPerGram * 100,
    // Only trustworthy once a reasonable share of meals carry cost.
    hasData: costPerGram != null && mealsWithCost >= 1,
  }
}

// -----------------------------------------------------------------------------
// monthlyFoodBurn(): projected food spend for the CURRENT month (straight-line
// from spend-so-far) versus the average of the prior 3 full months.
// -----------------------------------------------------------------------------
export function monthlyFoodBurn(transactions = [], { today = isoToday() } = {}) {
  const month = monthKey(today)
  const dayOfMonth = Number(today.slice(8, 10))
  const daysInMonth = daysInMonthOf(today)

  const foodExpenseByMonth = new Map()
  for (const t of transactions) {
    if (t.kind !== 'expense') continue
    if (!classifyFoodTxn(t)) continue
    const mk = monthKey(t.date)
    foodExpenseByMonth.set(mk, (foodExpenseByMonth.get(mk) || 0) + (Number(t.amount) || 0))
  }

  const spentSoFar = foodExpenseByMonth.get(month) || 0
  const projected = dayOfMonth > 0 ? (spentSoFar / dayOfMonth) * daysInMonth : 0

  const prevKeys = prevMonthKeys(today, 3)
  const prevValues = prevKeys.map((k) => foodExpenseByMonth.get(k) || 0)
  const monthsWithData = prevValues.filter((v) => v > 0)
  const average =
    monthsWithData.length > 0 ? monthsWithData.reduce((a, b) => a + b, 0) / monthsWithData.length : null

  const delta = average != null && average > 0 ? (projected - average) / average : null

  return {
    month,
    spentSoFar,
    projected,
    average, // avg food spend over prior full months that had any (null if none)
    monthsOfHistory: monthsWithData.length,
    delta, // projected vs. average as a fraction (null if no baseline)
    hasData: spentSoFar > 0 || average != null,
  }
}

// -----------------------------------------------------------------------------
// proteinBudgetEfficiency(): rank foods in the library by cost per 30g of
// protein — the "cheapest protein you own" list. Only foods with both a cost
// and protein qualify.
// -----------------------------------------------------------------------------
export function proteinBudgetEfficiency(foods = []) {
  const ranked = []
  for (const f of foods) {
    const cost = f.cost == null || f.cost === '' ? null : Number(f.cost)
    const protein = Number(f.protein) || 0
    if (cost == null || !(cost > 0) || protein <= 0) continue
    const costPerGram = cost / protein
    ranked.push({
      id: f.id,
      name: f.name,
      serving_desc: f.serving_desc || '',
      cost,
      protein,
      calories: Number(f.calories) || 0,
      carbs: Number(f.carbs) || 0,
      fat: Number(f.fat) || 0,
      costPerGram,
      costPer30g: costPerGram * 30,
      costPer100g: costPerGram * 100,
    })
  }
  ranked.sort((a, b) => a.costPerGram - b.costPerGram)

  return {
    ranked,
    priced: ranked.length,
    total: foods.length,
    coverage: foods.length > 0 ? ranked.length / foods.length : null,
    hasData: ranked.length > 0,
  }
}

// -----------------------------------------------------------------------------
// Aggregate everything the dashboard needs in one pass, including the
// "your bulk costs $X/mo" projection (what a month of hitting your protein
// target would cost at your current cost-per-protein). Falls back to the
// cheapest library protein when nothing priced has been logged yet.
// -----------------------------------------------------------------------------
export function computeFoodCost(
  { transactions = [], foodLogs = [], foods = [], nutritionTargets = null } = {},
  { today = isoToday() } = {}
) {
  const spend = costPerDay(transactions, { today })
  const protein = costPerProtein(foodLogs, { today })
  const burn = monthlyFoodBurn(transactions, { today })
  const efficiency = proteinBudgetEfficiency(foods)

  // Cost per gram of protein for the "bulk" projection: prefer what you've
  // actually been eating; fall back to the cheapest priced food in the library.
  const loggedPerGram = protein.costPerGram
  const libraryPerGram = efficiency.ranked[0]?.costPerGram ?? null
  const bulkPerGram = loggedPerGram ?? libraryPerGram
  const bulkSource = loggedPerGram != null ? 'logged' : libraryPerGram != null ? 'library' : null

  const proteinTarget = Number(nutritionTargets?.protein) || 0
  const daysInMonth = daysInMonthOf(today)
  const bulkMonthlyCost =
    proteinTarget > 0 && bulkPerGram != null ? bulkPerGram * proteinTarget * daysInMonth : null

  return {
    today,
    spend,
    protein,
    burn,
    efficiency,
    bulk:
      bulkMonthlyCost == null
        ? null
        : {
            monthlyCost: bulkMonthlyCost,
            proteinTarget,
            perGram: bulkPerGram,
            source: bulkSource, // 'logged' | 'library'
          },
    // The hero card can render as soon as ANY of the food signals exist.
    hasData: spend.hasData || protein.hasData || efficiency.hasData,
  }
}
