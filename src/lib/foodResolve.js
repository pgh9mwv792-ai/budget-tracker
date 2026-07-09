// Shared name/alias resolution for the food library. Used by the unified food
// search sheet and by the assistant's log_food tool so both resolve a spoken or
// typed food name the same way.
//
// Resolution order (per the branded-food spec): exact alias match in the library
// → exact library name match → (caller falls through to USDA/database search).
// Substring and USDA lookups are intentionally NOT done here — those belong to
// the caller and run only after this returns no match.

const norm = (s) => String(s ?? '').trim().toLowerCase()

const aliasesOf = (food) => (Array.isArray(food?.aliases) ? food.aliases : [])

// Free-text search predicate: a food matches if the query is a substring of its
// name OR of any of its aliases (case-insensitive). Powers the "My foods" filter.
export function foodMatchesQuery(food, query) {
  const q = norm(query)
  if (!q) return false
  if (norm(food?.name).includes(q)) return true
  return aliasesOf(food).some((a) => norm(a).includes(q))
}

// Resolve a name against the library. Returns:
//   { match, via, ambiguous }
// - match:     the single resolved food, or null.
// - via:       'alias' | 'name' | null — how it matched.
// - ambiguous: array of >1 candidate foods when several claim the same exact
//              alias/name (caller should ask which one); null otherwise.
export function resolveLibraryFood(foods, name) {
  const q = norm(name)
  if (!q || !Array.isArray(foods)) return { match: null, via: null, ambiguous: null }

  const aliasHits = foods.filter((f) => aliasesOf(f).some((a) => norm(a) === q))
  if (aliasHits.length === 1) return { match: aliasHits[0], via: 'alias', ambiguous: null }
  if (aliasHits.length > 1) return { match: null, via: 'alias', ambiguous: aliasHits }

  const nameHits = foods.filter((f) => norm(f?.name) === q)
  if (nameHits.length === 1) return { match: nameHits[0], via: 'name', ambiguous: null }
  if (nameHits.length > 1) return { match: null, via: 'name', ambiguous: nameHits }

  return { match: null, via: null, ambiguous: null }
}
