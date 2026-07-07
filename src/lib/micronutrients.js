// Day-level micronutrient aggregation for the Meals tab. Pure + unit-tested.
//
// Foods store canonical per-serving micronutrient rows (those carrying an `id`,
// produced by normalizeFoodNutrients). A food_log only snapshots macros, so we
// look up each log's food by id to read its normalized micros, then sum
//   Σ  normalized.amount × log.servings
// across the day — exactly how macros already total.
//
// Coverage honesty: micros are only as complete as the foods that report them.
// For each nutrient we track what share of the day's calories came from foods
// that report it. Below COVERAGE_THRESHOLD the UI prefixes the value with "~"
// (and explains why), so a day of mostly un-profiled foods doesn't read as if
// the user genuinely got little of a nutrient.

import { NUTRIENTS, NUTRIENT_BY_ID, CURATED_ORDER, defaultTargets } from './nutrients'

export const COVERAGE_THRESHOLD = 0.7

// The normalized (id-bearing) rows of a food, i.e. the canonical per-serving set.
function normalizedEntries(food) {
  const raw = Array.isArray(food?.nutrients) ? food.nutrients : []
  return raw.filter((e) => e && e.id)
}

// Sum a day's normalized micronutrients across its logs.
//   logs:       food_logs for the day (each { food_id, servings, calories }).
//   foodsById:  Map<food_id, food> so we can read each log's normalized micros.
// Returns { totals: Map<id,amount>, coverage: Map<id,fraction>, dayCalories }.
// coverage[id] = (calories from foods reporting id) / (total day calories); it is
// 1 when there are no calories to weigh by (nothing to be dishonest about).
export function dayMicronutrients(logs, foodsById) {
  const totals = new Map()
  const coveredCalories = new Map()
  let dayCalories = 0

  for (const log of logs ?? []) {
    const servings = Number(log?.servings) || 0
    const logCalories = (Number(log?.calories) || 0) * servings
    dayCalories += logCalories

    const food = log?.food_id != null ? foodsById.get(log.food_id) : null
    const entries = food ? normalizedEntries(food) : []
    const reported = new Set()
    for (const e of entries) {
      const amount = (Number(e.amount) || 0) * servings
      totals.set(e.id, (totals.get(e.id) || 0) + amount)
      reported.add(e.id)
    }
    // Credit this log's calories toward coverage of every nutrient its food
    // reports (once per nutrient, regardless of how many rows collapsed into it).
    for (const id of reported) {
      coveredCalories.set(id, (coveredCalories.get(id) || 0) + logCalories)
    }
  }

  const coverage = new Map()
  for (const n of NUTRIENTS) {
    coverage.set(n.id, dayCalories > 0 ? (coveredCalories.get(n.id) || 0) / dayCalories : 1)
  }

  return { totals, coverage, dayCalories }
}

// Merge the built-in RDA/UL defaults for the user's cohort with their per-nutrient
// overrides. A nutrient present in micro_targets uses that {target, upper_limit}
// verbatim (null = intentionally no target/UL); absent nutrients use the default.
export function effectiveTargets(targetsRow) {
  const sex = targetsRow?.sex ?? 'neutral'
  const overrides = targetsRow?.micro_targets ?? {}
  const base = defaultTargets(sex)
  const out = {}
  for (const n of NUTRIENTS) {
    const o = overrides[n.id]
    out[n.id] =
      o && typeof o === 'object'
        ? { target: o.target ?? null, upper_limit: o.upper_limit ?? null }
        : base[n.id]
  }
  return out
}

// Build the curated display rows (in catalog order) the Micronutrients section
// renders: consumed amount, target, UL, %, coverage flag, and over-UL flag.
export function micronutrientRows(logs, foodsById, targetsRow) {
  const { totals, coverage } = dayMicronutrients(logs, foodsById)
  const targets = effectiveTargets(targetsRow)
  return CURATED_ORDER.map((id) => {
    const meta = NUTRIENT_BY_ID.get(id)
    const amount = totals.get(id) || 0
    const { target, upper_limit } = targets[id] ?? { target: null, upper_limit: null }
    const cover = coverage.get(id) ?? 1
    const hasTarget = target != null && Number(target) > 0
    const pct = hasTarget ? (amount / Number(target)) * 100 : 0
    const overUL = upper_limit != null && amount > Number(upper_limit)
    return {
      id,
      name: meta.name,
      unit: meta.unit,
      amount,
      target: hasTarget ? Number(target) : null,
      upperLimit: upper_limit != null ? Number(upper_limit) : null,
      coverage: cover,
      lowCoverage: cover < COVERAGE_THRESHOLD,
      pct,
      overUL,
    }
  })
}
