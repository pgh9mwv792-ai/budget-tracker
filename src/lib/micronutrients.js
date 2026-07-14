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

// Omega-3 display: EPA and DHA are stored/summed like any nutrient but surfaced
// only through the combined EPA+DHA row (the preformed, directly-usable marine
// omega-3), never as their own bars. `epa_dha` is a synthetic id with no catalog
// entry, so its metadata lives here. It leads the omega-3 group as the PRIMARY
// row, carrying a reference range (there is no formal RDA) and, deliberately,
// no bar — you can't measure against an intake that doesn't exist.
//
// We do NOT show a single "omega-3 total" that sums ALA with EPA+DHA at face
// value: ALA from plants converts to EPA/DHA only ~5–10%, so a naive sum
// overstates usable omega-3. ALA is shown as a separate, subordinate row instead.
const EPA_DHA_META = {
  id: 'epa_dha',
  name: 'EPA + DHA',
  unit: 'g',
  omegaRole: 'primary',
  subtitle: 'preformed — directly usable (fish, eggs)',
  reference: '250–500 mg/day combined · reference, not an RDA',
}
// One-line education for the omega-3 group, shown under the ALA row.
const OMEGA_GROUP_NOTE =
  'Preformed EPA/DHA (fish, eggs) is used directly; ALA (plants) converts to EPA/DHA only ~5–10%, so they’re shown separately rather than summed.'
// Ids the section renders as their own standalone row (EPA/DHA fold into EPA+DHA).
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

// USDA nutrient numbers for the two vitamin A precursors a food can break out:
// preformed retinol (from animals) vs beta-carotene (from plants). Kept on the
// food as raw (non-id) rows alongside the summed RAE total.
const RETINOL_NUM = '319'
const BETA_CAROTENE_NUM = '321'

// Classify a vitamin A contributor's form from the food's raw USDA rows. RAE
// already bakes in the 12:1 beta-carotene→retinol conversion, so we compare each
// precursor's RAE contribution (retinol 1:1, beta-carotene ÷12) to name the
// dominant source. Display/education only — it never changes the RAE total.
// Returns 'preformed' | 'plant' | 'mixed', or null when the food gives no
// breakdown (e.g. a supplement that reports only a lumped "vitamin A").
export function vitaminAForm(food) {
  const raw = Array.isArray(food?.nutrients) ? food.nutrients : []
  let retinol = null
  let carotene = null
  for (const e of raw) {
    if (!e || e.id) continue // skip normalized rows; the breakdown is in the raw rows
    const num = e.usda_number != null ? String(e.usda_number) : null
    if (num === RETINOL_NUM) retinol = Number(e.amount) || 0
    else if (num === BETA_CAROTENE_NUM) carotene = Number(e.amount) || 0
  }
  if (retinol == null && carotene == null) return null
  const retinolRae = retinol ?? 0
  const caroteneRae = (carotene ?? 0) / 12
  const totalRae = retinolRae + caroteneRae
  if (totalRae <= 0) return null
  const plantShare = caroteneRae / totalRae
  if (plantShare >= 0.85) return 'plant'
  if (plantShare <= 0.15) return 'preformed'
  return 'mixed'
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
      // Vitamin A contributors carry a form tag (retinol vs beta-carotene) so the
      // dropdown can show which foods gave preformed vs plant-source vitamin A.
      const form = id === 'vitamin_a' ? vitaminAForm(food) : null
      byFood.set(food.id, { foodId: food.id, name, amount, markers, form })
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
      // Informational rows (the EPA+DHA row) carry a running total with no bar —
      // there is no established intake to measure them against.
      informational,
      amount,
      target: hasTarget ? Number(target) : null,
      upperLimit: upper_limit != null ? Number(upper_limit) : null,
      coverage: cover,
      lowCoverage: cover < COVERAGE_THRESHOLD,
      pct,
      overUL,
      // Optional omega-3 display hints (undefined for ordinary nutrients).
      omegaRole: meta.omegaRole ?? null,
      subtitle: meta.subtitle ?? null,
      reference: meta.reference ?? null,
      groupNote: meta.groupNote ?? null,
    }
  }

  const rows = []
  for (const id of CURATED_ORDER) {
    if (HIDDEN_IN_ROLLUP.has(id)) continue // EPA/DHA surface via the EPA+DHA row
    // Retire the face-value omega-3 total from display: summing ALA with EPA+DHA
    // overstates usable omega-3 (ALA converts poorly). Lead the omega-3 group
    // with the preformed EPA+DHA row instead. The raw acids are still stored.
    if (id === 'omega_3_total') {
      rows.push(buildRow(EPA_DHA_META, true))
      continue
    }
    // ALA: a real AI-target row, but subordinate to EPA+DHA and labeled with its
    // poor conversion. It also anchors the group's one-line educational note.
    if (id === 'ala') {
      rows.push(
        buildRow({
          ...NUTRIENT_BY_ID.get('ala'),
          omegaRole: 'secondary',
          subtitle: '~5–10% converts to EPA/DHA',
          groupNote: OMEGA_GROUP_NOTE,
        })
      )
      continue
    }
    rows.push(buildRow(NUTRIENT_BY_ID.get(id)))
  }
  return rows
}
