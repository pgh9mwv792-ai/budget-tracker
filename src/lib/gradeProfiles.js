// Food GRADES — the quality tier of a base food (pasture-raised eggs, grass-fed
// beef, wild vs. farmed salmon, whole vs. skim milk, organic…). This file is the
// GATE for the whole feature: a grade exists here ONLY if it has either a
// distinct USDA entry (Tier 1) or a cited peer-reviewed composition study
// (Tier 2). Everything else is a label (Tier 3) that changes no nutrition.
//
// Cardinal rule (from the design reference): a grade SELECTS better data — it
// never multiplies or invents numbers. Tier 2 override values below are absolute
// amounts entered from the cited paper's tables (per 100 g of the food), each
// with its citation in a comment. Never derive these from memory or from a
// document's directional summary.
//
// Tiers:
//   1 — routing:  a real USDA entry exists; the grade just picks/re-ranks it.
//   2 — profile:  no dedicated USDA entry, but cited literature supports specific
//                 override nutrients, merged over the base tagged `profile:<id>`.
//   3 — label:    store the claim for cost/filtering/honesty; change no nutrition.
//
// Override values are per-100 g and get scaled to the food's own serving at apply
// time (same basis as enrichment), so a grade lines up with the food's macros.

import { parseServingGrams } from './foodEnrich'

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
// Each family matches on keywords (whole-word, case-insensitive) against the
// food's name/query. `grades[0]` is the sensible default chip (usually the plain
// / conventional option). Tier-1 grades carry `route` (search term + optional
// preferred fdcIds). Tier-2 grades carry `overrides` (per-100 g canonical rows)
// or `labelDriven:true` when the value comes from the scanned label itself.

export const GRADE_FAMILIES = [
  {
    id: 'eggs',
    label: 'Eggs',
    keywords: ['egg', 'eggs'],
    grades: [
      { id: 'egg_conventional', label: 'Conventional', tier: 3 },
      {
        id: 'egg_pasture_raised',
        label: 'Pasture-raised',
        tier: 2,
        // CITATION GAP — Karsten et al. 2010, Renewable Agriculture and Food
        // Systems 25(1):45-54 (Penn State pastured-egg study) is paywalled; its
        // Table values (absolute vitamin A/E, ALA, DHA per egg/yolk) could not be
        // verified from an authoritative open source. Public sources report only
        // relative deltas (≈2x vitamin E, ≈2–2.5x omega-3, +38% vitamin A conc.,
        // vitamin D higher with real sun). Per the cardinal rule we DO NOT enter
        // multiplier-derived numbers. Until the paper's table is obtained, this
        // profile applies no overrides (behaves as a stored label). Fill `overrides`
        // with per-100 g absolutes from the paper — e.g. vitamin_e (mg), ala (g),
        // dha (g), vitamin_a (mcg RAE), vitamin_d (mcg) — then the demo lights up.
        overrides: [],
        citation: 'Karsten et al. 2010, Renewable Agric. Food Syst. 25(1):45-54 — values pending (paywalled table).',
      },
      {
        id: 'egg_omega3',
        label: 'Omega-3 enriched',
        tier: 2,
        // Flax-fed / omega-3 eggs PRINT their ALA/DHA claim (it's the selling
        // point). The value is the label's own stated number, captured at scan
        // time — a rare case where the label is the best source — so there is
        // nothing to hardcode here.
        labelDriven: true,
        citation: "Product label (feeding-trial-consistent); enters at scan time like any label nutrient.",
      },
      { id: 'egg_cage_free', label: 'Cage-free', tier: 3 }, // housing ≠ diet
      { id: 'egg_free_range', label: 'Free-range', tier: 3 }, // housing ≠ diet
    ],
  },
  {
    id: 'beef',
    label: 'Ground beef',
    keywords: ['beef', 'ground beef', 'hamburger'],
    grades: [
      {
        id: 'beef_conventional',
        label: 'Grain-finished',
        tier: 1,
        route: { term: 'beef ground', preferFdcIds: ['174036'], match: [] },
      },
      {
        id: 'beef_grass_fed',
        label: 'Grass-fed',
        tier: 1,
        // USDA maintains a distinct grass-fed entry (fdcId 168608, SR Legacy:
        // "Beef, grass-fed, ground, raw"). Evidence for why the grade matters:
        // Daley et al. 2010, Nutrition Journal (higher omega-3, better n-6:n-3,
        // more CLA, more vitamin E). We just route to the right entry.
        route: { term: 'beef ground grass-fed', preferFdcIds: ['168608'], match: ['grass'] },
      },
    ],
  },
  {
    id: 'salmon',
    label: 'Salmon',
    keywords: ['salmon'],
    grades: [
      {
        id: 'salmon_wild',
        label: 'Wild',
        tier: 1,
        // USDA "Fish, salmon, Atlantic, wild, raw" (fdcId 173686): leaner, more
        // protein per calorie, better n-6:n-3. Sockeye/coho entries are wild-type.
        route: { term: 'salmon wild', preferFdcIds: ['173686'], match: ['wild', 'sockeye', 'coho'] },
      },
      {
        id: 'salmon_farmed',
        label: 'Farmed',
        tier: 1,
        // USDA "Fish, salmon, Atlantic, farmed, raw" (fdcId 175167): higher total
        // fat and usually higher absolute EPA+DHA. Neither is strictly "better".
        route: { term: 'salmon atlantic farmed', preferFdcIds: ['175167'], match: ['farmed', 'atlantic'] },
      },
    ],
  },
  {
    id: 'milk',
    label: 'Milk',
    keywords: ['milk'],
    grades: [
      {
        id: 'milk_whole',
        label: 'Whole',
        tier: 1,
        route: { term: 'milk whole', preferFdcIds: ['171265'], match: ['whole'] },
      },
      {
        id: 'milk_2pct',
        label: '2%',
        tier: 1,
        route: { term: 'milk reduced fat 2%', preferFdcIds: ['171267'], match: ['2%', 'reduced fat'] },
      },
      {
        id: 'milk_1pct',
        label: '1%',
        tier: 1,
        route: { term: 'milk lowfat 1%', preferFdcIds: [], match: ['1%', 'lowfat'] },
      },
      {
        id: 'milk_skim',
        label: 'Skim',
        tier: 1,
        route: { term: 'milk nonfat skim', preferFdcIds: ['171270'], match: ['nonfat', 'skim', 'fat free'] },
      },
      {
        id: 'milk_grass_fed',
        label: 'Grass-fed',
        tier: 2,
        // Benbrook et al. 2013, PLOS ONE 8(12):e82429 — US-wide 18-month milk
        // sampling. Table 2 (12-month means), organic/grass-based herds, per 100 g
        // of milk: total omega-3 0.0321 g, ALA (18:3 n-3) 0.0255 g, CLA 0.0227 g
        // (CLA has no catalog id, so it's noted but not applied). n-6:n-3 = 2.28
        // (vs 5.77 conventional). Applied over a whole-milk base.
        overrides: [
          { id: 'omega_3_total', amount: 0.0321, unit: 'g' }, // Benbrook 2013, Table 2 (per 100 g milk)
          { id: 'ala', amount: 0.0255, unit: 'g' }, // Benbrook 2013, Table 2 (per 100 g milk)
        ],
        citation: 'Benbrook et al. 2013, PLOS ONE 8(12):e82429, Table 2 (per 100 g milk).',
      },
    ],
  },
  // ---- Tier-3-only families (label claims that ride on top of any base) ----
  {
    id: 'organic',
    label: 'Organic',
    keywords: ['organic'],
    // Smith-Spangler et al. 2012 (Ann. Intern. Med.) & Barański et al. 2014: no
    // consistent panel-level nutrient differences. Capture for cost/filtering.
    grades: [{ id: 'organic', label: 'Organic', tier: 3 }],
  },
  {
    id: 'a2_milk',
    label: 'A2 milk',
    keywords: ['a2'],
    // Casein-variant claim; nutritionally identical panel to regular milk of the
    // same fat level. Label-only, but carries a price premium worth showing.
    grades: [{ id: 'a2_milk', label: 'A2', tier: 3 }],
  },
]

// Flatten for id lookups.
const GRADE_BY_ID = new Map()
for (const fam of GRADE_FAMILIES) {
  for (const g of fam.grades) GRADE_BY_ID.set(g.id, { ...g, family: fam.id })
}

// Whole-word, case-insensitive keyword test (so "milkshake" doesn't match "milk"
// but "whole milk" does).
function hasKeyword(text, keyword) {
  const t = ` ${String(text ?? '').toLowerCase()} `
  const k = String(keyword).toLowerCase()
  // Word-boundary match on the keyword's first token; multi-word keywords match
  // as a substring bounded by non-letters.
  const re = new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i')
  return re.test(` ${text ?? ''} `) || t.includes(` ${k} `)
}

// The grade family a search query / food name belongs to, or null. First match
// wins (families are ordered specific→generic, with plain label families last).
export function familyForText(text) {
  if (!text) return null
  for (const fam of GRADE_FAMILIES) {
    if (fam.keywords.some((k) => hasKeyword(text, k))) return fam
  }
  return null
}

// The selectable grades for a query (empty when it matches no family).
export function gradesForText(text) {
  return familyForText(text)?.grades ?? []
}

export function gradeById(id) {
  return id ? GRADE_BY_ID.get(id) ?? null : null
}

export function gradeLabel(id) {
  return gradeById(id)?.label ?? null
}

// The USDA search term a Tier-1 grade routes to (also used as the grade-aware
// base term for enrichment). Null for grades with no routing.
export function gradeSearchTerm(id) {
  const g = gradeById(id)
  return g?.route?.term ?? null
}

// Re-rank USDA results for a Tier-1 grade: entries matching the grade's `match`
// keywords (or its preferred fdcIds) float to the top, order otherwise preserved.
export function rankResultsForGrade(results, id) {
  const g = gradeById(id)
  if (!g?.route || !Array.isArray(results)) return results ?? []
  const prefer = new Set((g.route.preferFdcIds ?? []).map(String))
  const match = (g.route.match ?? []).map((m) => m.toLowerCase())
  const score = (r) => {
    if (prefer.has(String(r.fdcId))) return 2
    const name = String(r.name ?? '').toLowerCase()
    return match.some((m) => name.includes(m)) ? 1 : 0
  }
  // Stable sort by descending score.
  return results
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r)
}

// ---------------------------------------------------------------------------
// Tier-2 profile merge / strip (reversible — base data is never destroyed)
// ---------------------------------------------------------------------------
// Applying a profile overrides specific canonical rows with the grade's cited
// values (scaled to the food's serving). The base value is stashed on the row
// (`profile_base_*`) so switching grades or clearing the grade restores it
// exactly. Rows the profile ADDS (no base) are simply dropped on strip.

const isNormalized = (e) => e && e.id

// Remove any applied profile: restore stashed base values, drop profile-only
// rows. Idempotent — a food with no profile comes back unchanged.
export function stripGradeProfile(food) {
  const rows = Array.isArray(food?.nutrients) ? food.nutrients : []
  const out = []
  for (const e of rows) {
    if (!e || e.profile == null) {
      out.push(e)
      continue
    }
    if (e.profile_base_amount !== undefined) {
      // Restore the base row; drop the profile tags/stash.
      const { profile: _p, profile_base_amount, profile_base_unit, ...base } = e
      void _p
      out.push({ ...base, amount: profile_base_amount, unit: profile_base_unit ?? base.unit })
    }
    // else: purely profile-added row → omit it.
  }
  return out
}

// Apply a Tier-2 grade's overrides to a food, returning a new nutrients array
// (tagged `profile:<id>`). Switching grades is safe: any existing profile is
// stripped first, so we always merge over the pristine base. Returns null when
// the grade isn't a Tier-2 profile with applicable overrides (nothing to merge —
// the caller just stores the grade string).
export function applyGradeProfile(food, id) {
  const g = gradeById(id)
  if (!g || g.tier !== 2 || !Array.isArray(g.overrides) || g.overrides.length === 0) return null

  const grams = parseServingGrams(food?.serving_desc)
  if (grams == null || !(grams > 0)) return null // can't scale per-100 g honestly
  const scale = grams / 100

  const base = stripGradeProfile(food) // pristine rows to merge over
  const overrideById = new Map(g.overrides.map((o) => [o.id, o]))
  const out = []
  const applied = new Set()

  for (const e of base) {
    const o = isNormalized(e) ? overrideById.get(e.id) : null
    if (o) {
      out.push({
        ...e,
        amount: o.amount * scale,
        unit: o.unit,
        profile: id,
        profile_base_amount: e.amount,
        profile_base_unit: e.unit,
      })
      applied.add(o.id)
    } else {
      out.push(e)
    }
  }
  // Overrides with no matching base row are added fresh (no base to stash).
  for (const o of g.overrides) {
    if (!applied.has(o.id)) out.push({ id: o.id, amount: o.amount * scale, unit: o.unit, profile: id })
  }
  return out
}

// Convenience for the food-save / grade-edit flows: given a food and a chosen
// grade id (or null to clear), return the nutrients array to persist. Always
// strips any prior profile first, then applies the new one when it's Tier 2.
export function nutrientsForGrade(food, id) {
  const stripped = stripGradeProfile(food)
  if (!id) return stripped
  const applied = applyGradeProfile({ ...food, nutrients: stripped }, id)
  return applied ?? stripped
}
