import { NUTRIENTS, NUTRIENT_BY_ID, normalizeFoodNutrients } from './nutrients'

// Micronutrient enrichment (Part 4). A branded / label-scanned / web-sourced food
// usually lists only the handful of nutrients the package prints (calories, a few
// macros, maybe sodium and a vitamin or two). This borrows the REST of the
// micronutrient profile — choline, magnesium, selenium, etc. — from a generic
// USDA equivalent the user picks, filling ONLY the canonical nutrient ids the
// branded entry is missing. Borrowed rows are tagged `enriched_from: <fdcId>` so
// the app can show they came from a generic stand-in, and the branded food's own
// label numbers are never touched. Always user-invoked and previewed first.

// The canonical nutrient ids a food already reports (its normalized id-bearing
// rows). These are the ones enrichment must NOT overwrite.
export function existingMicroIds(food) {
  const rows = Array.isArray(food?.nutrients) ? food.nutrients : []
  return new Set(rows.filter((e) => e && e.id).map((e) => e.id))
}

// Pull a gram weight from a serving description ("1 bar (60 g)", "150 g").
export function parseServingGrams(desc) {
  const s = String(desc ?? '')
  const paren = s.match(/\(([\d.]+)\s*g\)/i)
  if (paren) return Number(paren[1])
  const trailing = s.match(/([\d.]+)\s*g\b/i)
  if (trailing) return Number(trailing[1])
  return null
}

// Build a preview of what enriching `food` from a generic USDA food would add,
// WITHOUT mutating anything. `genericDetail` is a getFoodDetails() record (its
// `nutrients` are raw per-100g USDA rows; `fdcId` identifies the source).
//
// Returns:
//   { added:     [{ id, name, amount, unit }]  — rows that would be filled in,
//     nutrients: [...food.nutrients, ...newRows] — the merged array to save,
//     servingGrams: number|null }               — the branded serving we scaled to
// or null when nothing new could be derived (bad input / no missing nutrients).
export function buildEnrichment(food, genericDetail) {
  if (!food || !genericDetail) return null
  const rawGeneric = Array.isArray(genericDetail.nutrients) ? genericDetail.nutrients : []
  if (!rawGeneric.length) return null

  // The generic's raw rows are per 100 g; scale to the branded food's own serving
  // so the borrowed micros line up with its label macros. Without a gram weight we
  // can't scale honestly, so bail rather than guess.
  const grams = parseServingGrams(food.serving_desc)
  if (grams == null || !(grams > 0)) return null
  const scale = grams / 100

  const normalized = normalizeFoodNutrients(rawGeneric, { source: 'usda', servingScale: scale })
  const have = existingMicroIds(food)
  const fdcId = String(genericDetail.fdcId ?? '')

  const newRows = normalized
    .filter((r) => r && r.id && !have.has(r.id))
    .map((r) => ({ ...r, enriched_from: fdcId }))
  if (!newRows.length) return null

  const added = newRows.map((r) => ({
    id: r.id,
    name: NUTRIENT_BY_ID.get(r.id)?.name ?? r.id,
    amount: r.amount,
    unit: r.unit,
  }))

  const existing = Array.isArray(food.nutrients) ? food.nutrients : []
  return { added, nutrients: [...existing, ...newRows], servingGrams: grams }
}

// The canonical nutrients this food does NOT yet report — a compact "what could
// enrichment add" hint for the UI before a source is even chosen.
export function missingCanonicalNutrients(food) {
  const have = existingMicroIds(food)
  return NUTRIENTS.filter((n) => !have.has(n.id)).map((n) => ({ id: n.id, name: n.name }))
}
