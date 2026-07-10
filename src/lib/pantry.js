// Pantry = the nutrition a grocery run brought home. Pure helpers, no I/O.
//
// Two jobs:
//   1. suggestFoodMapping — pick the best library food for a terse receipt line,
//      alias- and grade-aware, so the itemizer can pre-suggest a mapping instead
//      of making the user search every line.
//   2. aggregatePantry — once lines are mapped, roll them into "what did this
//      shop buy": grams of protein purchased, calories, and the cost per 100g of
//      protein for the whole run — the app's money+food differentiator applied
//      at purchase time, not just at meal time. Honest coverage: only lines whose
//      weight AND per-mass macros are known contribute nutrition; the rest still
//      count toward spend, and `coverage` reports the priced fraction.

import { foodSearchQuery, itemKey } from './receiptMatch'
import { resolveLibraryFood } from './foodResolve'
import { gradesForText } from './gradeProfiles'

const norm = (s) => String(s ?? '').trim().toLowerCase()
const aliasesOf = (food) => (Array.isArray(food?.aliases) ? food.aliases : [])

// Grams a mass-unit quantity represents, or null when not a mass (each/count) or
// missing. Handles lb/oz/g/kg (and common spellings).
export function gramsBought(quantity, unit) {
  const q = Number(quantity)
  if (!Number.isFinite(q) || q <= 0) return null
  const u = norm(unit)
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return q * 453.592
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return q * 28.3495
  if (u === 'kg' || u === 'kgs' || u === 'kilogram' || u === 'kilograms') return q * 1000
  if (u === 'g' || u === 'gram' || u === 'grams') return q
  return null
}

// Grams one serving of a food represents, parsed from its serving_desc when it's
// a mass measure ("100 g", "3 oz", "1 lb"). Non-mass servings (cups, each) → null.
export function servingGrams(food) {
  const desc = norm(food?.serving_desc)
  if (!desc) return null
  const m = desc.match(/([\d.]+)\s*(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kgs)\b/)
  if (!m) return null
  return gramsBought(Number(m[1]), m[2])
}

// Suggest the single best library food for a raw receipt line. Returns
// { food, via, score } or null when nothing is a confident-enough match.
//   via: 'alias' (exact alias/name hit) | 'grade' (shares a food family/grade)
//        | 'tokens' (word overlap on name/aliases).
// Scoring is deliberately conservative — a weak token overlap returns null so the
// itemizer doesn't pre-fill a wrong guess the user then has to undo.
export function suggestFoodMapping(rawName, foods = []) {
  if (!Array.isArray(foods) || foods.length === 0) return null

  // 1. Exact alias/name resolution (reuses the shared library resolver) on both
  //    the raw line and its abbreviation-expanded form.
  const expanded = foodSearchQuery(rawName)
  for (const candidate of [rawName, expanded]) {
    const { match, via } = resolveLibraryFood(foods, candidate)
    if (match) return { food: match, via, score: 1 }
  }

  // 2. Token overlap on name + aliases, lightly boosted when the line and the
  //    food share a grade family (e.g. both read as "chicken breast").
  const queryTokens = new Set(expanded.split(' ').filter((w) => w.length > 2))
  if (queryTokens.size === 0) return null
  const lineGrades = new Set(gradesForText(rawName).map((g) => g.id))

  let best = null
  for (const food of foods) {
    const nameTokens = new Set(
      [norm(food.name), ...aliasesOf(food).map(norm)]
        .join(' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
    )
    let overlap = 0
    for (const t of queryTokens) if (nameTokens.has(t)) overlap++
    if (overlap === 0) continue
    let score = overlap / queryTokens.size
    let via = 'tokens'
    const foodGrades = new Set(gradesForText(food.name).map((g) => g.id))
    if ([...lineGrades].some((g) => foodGrades.has(g))) {
      score += 0.25
      via = 'grade'
    }
    if (!best || score > best.score) best = { food, via, score }
  }

  // Require a real signal: at least a third of the query words matched (before
  // any grade boost pushed it over).
  if (best && best.score >= 0.34) return best
  return null
}

// Roll mapped receipt lines into the nutrition brought home. `items` are receipt
// items ({ is_food, food_id, price, quantity, unit }); `foodsById` is a Map from
// food id to the library food (per-serving macros + serving_desc).
//
// Returns:
//   { calories, protein, carbs, fat, spend, pricedSpend, coverage,
//     costPer100gProtein, itemCount, nutritionItemCount }
// where `spend` is every food line's price, `pricedSpend` is the spend on lines
// we could compute nutrition for, and `coverage = pricedSpend / spend`.
export function aggregatePantry(items = [], foodsById) {
  const get = (id) => (foodsById instanceof Map ? foodsById.get(id) : foodsById?.[id])
  const acc = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    spend: 0,
    pricedSpend: 0,
    itemCount: 0,
    nutritionItemCount: 0,
  }

  for (const it of items) {
    if (!it || !it.is_food || !it.food_id) continue
    const price = Number(it.price)
    const linePrice = Number.isFinite(price) && price > 0 ? price : 0
    acc.itemCount++
    acc.spend += linePrice

    const food = get(it.food_id)
    if (!food) continue
    const grams = gramsBought(it.quantity, it.unit)
    const sg = servingGrams(food)
    if (!grams || !sg) continue
    const servings = grams / sg
    acc.calories += (Number(food.calories) || 0) * servings
    acc.protein += (Number(food.protein) || 0) * servings
    acc.carbs += (Number(food.carbs) || 0) * servings
    acc.fat += (Number(food.fat) || 0) * servings
    acc.pricedSpend += linePrice
    acc.nutritionItemCount++
  }

  const coverage = acc.spend > 0 ? acc.pricedSpend / acc.spend : 0
  const costPer100gProtein = acc.protein > 0 ? (acc.pricedSpend / acc.protein) * 100 : null
  return { ...acc, coverage, costPer100gProtein }
}

// Stable key for a raw receipt line (re-exported for callers that build rules
// alongside a suggestion).
export { itemKey }
