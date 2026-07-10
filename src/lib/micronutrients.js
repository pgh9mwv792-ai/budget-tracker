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

// Omega-3 display rollups (computed at day-sum time, never stored per food):
//   • omega_3_total = generic "Omega-3" bucket + EPA + DHA + ALA
//   • epa_dha       = EPA + DHA (the "marine" omega-3 people ask about)
// EPA and DHA are stored/summed like any nutrient but surfaced only through these
// rollup rows, not their own bars (they have no reference intake to bar against).
// `epa_dha` is a synthetic id with no catalog entry, so its metadata lives here.
const EPA_DHA_META = { id: 'epa_dha', name: 'EPA + DHA', unit: 'g' }
// Ids the section renders as their own standalone row (EPA/DHA fold into rollups).
const HIDDEN_IN_ROLLUP = new Set(['epa', 'dha'])

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
    // A food reporting any omega-3 component counts toward the rollup rows' coverage.
    if (reported.has('epa') || reported.has('dha')) reported.add('epa_dha')
    if (reported.has('epa') || reported.has('dha') || reported.has('ala') || reported.has('omega_3_total')) {
      reported.add('omega_3_total')
    }
    // Credit this log's calories toward coverage of every nutrient its food
    // reports (once per nutrient, regardless of how many rows collapsed into it).
    for (const id of reported) {
      coveredCalories.set(id, (coveredCalories.get(id) || 0) + logCalories)
    }
  }

  // Computed omega-3 rollups: fold the specific acids (and any generic bucket)
  // into the display totals. Read the generic bucket first, then overwrite
  // omega_3_total with the full sum so the row shows every source once.
  const epa = totals.get('epa') || 0
  const dha = totals.get('dha') || 0
  const ala = totals.get('ala') || 0
  const genericOmega = totals.get('omega_3_total') || 0
  // Only materialize a rollup key when it actually aggregates something, so a day
  // with no omega-3 data leaves `totals` untouched.
  if (epa + dha > 0) totals.set('epa_dha', epa + dha)
  if (genericOmega + epa + dha + ala > 0) totals.set('omega_3_total', genericOmega + epa + dha + ala)

  const coverage = new Map()
  for (const n of NUTRIENTS) {
    coverage.set(n.id, dayCalories > 0 ? (coveredCalories.get(n.id) || 0) / dayCalories : 1)
  }
  coverage.set('epa_dha', dayCalories > 0 ? (coveredCalories.get('epa_dha') || 0) / dayCalories : 1)

  return { totals, coverage, dayCalories }
}

// A rollup row aggregates several stored ids; a plain nutrient is just itself.
// Used so the contributor breakdown for "Omega-3 (total)" or "EPA + DHA" sums
// the underlying acids across each food.
const ROLLUP_COMPONENTS = {
  omega_3_total: ['omega_3_total', 'epa', 'dha', 'ala'],
  epa_dha: ['epa', 'dha'],
}

// Per-food breakdown of one nutrient for the day, for the contributor dropdown:
//   • contributors: foods that supply the nutrient, each with its summed amount
//     (respecting servings), share (% of the day total), and provenance markers
//     (borrowed = enriched_from, profile = grade-derived, estimate). Sorted desc.
//   • notReported:  logged foods that don't report the nutrient at all.
// Pure — the component only renders it. `id` may be a rollup id (omega_3_total,
// epa_dha) or any catalog id.
export function nutrientContributors(id, logs, foodsById) {
  const componentIds = ROLLUP_COMPONENTS[id] ?? [id]
  const byFood = new Map() // food_id → { foodId, name, amount, markers }
  const missing = new Map() // food_id → { foodId, name }

  for (const log of logs ?? []) {
    const food = log?.food_id != null ? foodsById?.get(log.food_id) : null
    if (!food) continue // hand-typed logs with no library food can't be attributed
    const servings = Number(log?.servings) || 0
    const name = log?.name ?? food.name ?? 'Food'
    const rows = normalizedEntries(food).filter((e) => componentIds.includes(e.id))
    if (rows.length === 0) {
      if (!missing.has(food.id)) missing.set(food.id, { foodId: food.id, name: food.name ?? name })
      continue
    }
    const amount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * servings
    if (amount <= 0) continue
    const markers = {
      borrowed: rows.some((r) => r.enriched_from != null),
      profile: rows.some((r) => r.profile != null),
      estimate: food.source === 'estimate',
    }
    const prev = byFood.get(food.id)
    if (prev) {
      prev.amount += amount
      prev.markers.borrowed ||= markers.borrowed
      prev.markers.profile ||= markers.profile
    } else {
      byFood.set(food.id, { foodId: food.id, name, amount, markers })
    }
  }

  const contributors = [...byFood.values()].sort((a, b) => b.amount - a.amount)
  const total = contributors.reduce((s, c) => s + c.amount, 0)
  for (const c of contributors) c.pct = total > 0 ? (c.amount / total) * 100 : 0
  return { total, contributors, notReported: [...missing.values()] }
}

// The day's logged foods that don't report a given nutrient id — the target list
// for the low-coverage "fix" affordance (each becomes a one-tap enrichment entry).
// Returns [{ foodId, name, source }]; excludes foods that already report it.
export function foodsMissingNutrient(id, logs, foodsById) {
  const componentIds = ROLLUP_COMPONENTS[id] ?? [id]
  const seen = new Map()
  for (const log of logs ?? []) {
    const food = log?.food_id != null ? foodsById?.get(log.food_id) : null
    if (!food || seen.has(food.id)) continue
    const reports = normalizedEntries(food).some((e) => componentIds.includes(e.id))
    if (!reports) seen.set(food.id, { foodId: food.id, name: food.name, source: food.source })
  }
  return [...seen.values()]
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

  const buildRow = (meta, informational = false) => {
    const amount = totals.get(meta.id) || 0
    const { target, upper_limit } = targets[meta.id] ?? { target: null, upper_limit: null }
    const cover = coverage.get(meta.id) ?? 1
    const hasTarget = target != null && Number(target) > 0
    const pct = hasTarget ? (amount / Number(target)) * 100 : 0
    const overUL = upper_limit != null && amount > Number(upper_limit)
    return {
      id: meta.id,
      name: meta.name,
      unit: meta.unit,
      // 'target' (aim to reach, e.g. vitamins) vs 'limit' (cap, e.g. sat fat).
      kind: meta.kind ?? 'target',
      // Informational rows (omega-3 rollups) carry a running total with no bar —
      // there is no established intake to measure them against.
      informational,
      amount,
      target: hasTarget ? Number(target) : null,
      upperLimit: upper_limit != null ? Number(upper_limit) : null,
      coverage: cover,
      lowCoverage: cover < COVERAGE_THRESHOLD,
      pct,
      overUL,
    }
  }

  const rows = []
  for (const id of CURATED_ORDER) {
    if (HIDDEN_IN_ROLLUP.has(id)) continue // EPA/DHA surface via the rollups below
    const meta = NUTRIENT_BY_ID.get(id)
    rows.push(buildRow(meta, meta.rollup === true))
    // Slot the computed "EPA + DHA" row right under the Omega-3 total.
    if (id === 'omega_3_total') rows.push(buildRow(EPA_DHA_META, true))
  }
  return rows
}
