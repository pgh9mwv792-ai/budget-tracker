// One-time backfill: re-normalize the `nutrients` jsonb on every existing food.
//
// WHY: foods saved before the micronutrient feature stored only RAW nutrient rows
// (USDA per-100g rows, or supplement ingredient rows). This script adds the
// CANONICAL per-serving rows (each carrying an `id`) next to them, so old foods
// contribute to the day's micronutrient totals just like newly-saved ones. New
// foods already get both, so this is only needed once for the back catalog.
//
// It ALSO REPAIRS foods saved with an EMPTY micronutrient profile: a USDA food
// (has an `fdc_id`) whose `nutrients` holds no raw rows lost its micros because
// USDA's detail endpoint 404'd at save time (correct macros, but every micro
// reads 0). For those it RE-SEARCHES USDA by the food's name, matches the exact
// fdc_id, and stores the per-100g nutrients the search response carries (raw +
// normalized) — so the food's micros count again with no need to re-add it.
// Refetch needs a USDA_API_KEY env var (the same key the food-search function
// uses); without it those foods are reported and left as-is, and the rest run.
//
// It is SAFE TO RE-RUN: it first strips any existing id-bearing rows, then
// recomputes them from the raw rows — so running twice gives the same result.
//
// ── HOW TO RUN (do this once) ────────────────────────────────────────────────
// 1. In the Supabase dashboard, open Project Settings → API and copy two things:
//      • "Project URL"                (looks like https://xxxx.supabase.co)
//      • the "service_role" secret key (NOT the anon key — this one bypasses RLS
//        so the script can read/write every user's foods). Keep it private; never
//        put it in the app or commit it.
// 2. In a terminal, from the budget-tracker folder, run (paste your own values):
//
//      SUPABASE_URL="https://xxxx.supabase.co" \
//      SUPABASE_SERVICE_ROLE_KEY="paste-service-role-key" \
//      node scripts/backfill-nutrients.mjs
//
//    Add `--dry-run` on the end to preview counts without writing anything:
//      ... node scripts/backfill-nutrients.mjs --dry-run
// 3. When it prints "Done", the backfill is finished. You can delete these env
//    values from your shell history afterward.

import { createClient } from '@supabase/supabase-js'
import { normalizeFoodNutrients, servingScaleForFood } from '../src/lib/nutrients.js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const usdaKey = process.env.USDA_API_KEY
const dryRun = process.argv.includes('--dry-run')

if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'See the instructions at the top of this file for how to run it.'
  )
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

// Drop the previously-normalized rows (the ones with an `id`); keep raw rows.
const rawOnly = (nutrients) =>
  (Array.isArray(nutrients) ? nutrients : []).filter((e) => e && !e.id)

// Refetch one USDA food's full per-100g nutrient rows via the SEARCH endpoint,
// in the SAME shape the food-search edge function stores at save time
// ({ name, amount, unit, per:'100g', usda_number }). Returns [] on any miss so
// the caller can skip the food rather than wipe it.
//
// WHY search, not the detail endpoint: USDA's /food/{fdcId} detail endpoint 404s
// for some Foundation foods (e.g. whole egg fdcId 748967) even though the search
// response carries all ~95 nutrients. That 404 is exactly why these foods saved
// with a zeroed micro profile. We search by the food's name, then match the exact
// fdcId, and read the nutrients search already returned (nutrientNumber/value).
async function fetchUsdaRawNutrients(name, fdcId) {
  const resp = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: name,
        pageSize: 25,
        dataType: ['Foundation', 'SR Legacy', 'Branded'],
      }),
    }
  )
  if (!resp.ok) throw new Error(`USDA ${resp.status}`)
  const data = await resp.json()
  const match = (data.foods ?? []).find((f) => String(f.fdcId) === String(fdcId))
  if (!match) return []
  const rows = []
  for (const n of match.foodNutrients ?? []) {
    const nm = n.nutrientName
    const amount = Number(n.value)
    if (!nm || !Number.isFinite(amount)) continue
    const usda_number = n.nutrientNumber != null ? String(n.nutrientNumber) : null
    rows.push({ name: nm, amount, unit: n.unitName ?? '', per: '100g', usda_number })
  }
  return rows
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { data: foods, error } = await supabase
    .from('foods')
    .select('id, name, source, calories, serving_desc, nutrients, fdc_id')

  if (error) {
    console.error('Could not read foods:', error.message)
    process.exit(1)
  }

  let updated = 0
  let repaired = 0
  let skipped = 0
  let unscalable = 0
  let refetchFailed = 0
  let missingUsdaKey = 0

  for (const food of foods) {
    let raw = rawOnly(food.nutrients)

    // Empty profile on a USDA food (has an fdc_id): its micros were dropped at
    // save time. Refetch the per-100g rows from USDA so it can be re-normalized.
    if (raw.length === 0 && food.fdc_id && food.source === 'usda') {
      if (!usdaKey) {
        missingUsdaKey++
        console.warn(`  ! empty USDA profile, set USDA_API_KEY to repair: ${food.name} [${food.id}]`)
        continue
      }
      try {
        raw = await fetchUsdaRawNutrients(food.name, food.fdc_id)
        await sleep(100) // be gentle on the USDA rate limit between refetches
      } catch (e) {
        refetchFailed++
        console.warn(`  ! USDA refetch failed (${e.message}): ${food.name} [${food.id}]`)
        continue
      }
      if (raw.length === 0) {
        refetchFailed++
        console.warn(`  ! USDA search returned no matching food: ${food.name} [${food.id}] fdc_id=${food.fdc_id}`)
        continue
      }
    }

    if (raw.length === 0) {
      skipped++ // no raw micronutrients to normalize (e.g. hand-entered foods)
      continue
    }

    // Recover the per-serving scale from the (possibly just-refetched) raw rows.
    const scale = servingScaleForFood({ ...food, nutrients: raw })
    if (scale == null) {
      // USDA food with no way to recover its per-serving scale — leave it as-is
      // rather than store wrong amounts. Rare; logged so you can eyeball them.
      unscalable++
      console.warn(`  ! skipped (no serving scale): ${food.name} [${food.id}]`)
      continue
    }

    // Was this food empty before we refetched its raw rows? (Track repairs apart
    // from routine re-normalizations for a clearer summary.)
    const wasEmpty = rawOnly(food.nutrients).length === 0
    const normalized = normalizeFoodNutrients(raw, { source: food.source, servingScale: scale })
    const next = [...raw, ...normalized]

    if (dryRun) {
      if (wasEmpty) repaired++
      else updated++
      continue
    }

    const { error: upErr } = await supabase.from('foods').update({ nutrients: next }).eq('id', food.id)
    if (upErr) {
      console.error(`  ! failed to update ${food.name} [${food.id}]:`, upErr.message)
      continue
    }
    if (wasEmpty) repaired++
    else updated++
  }

  console.log(
    `${dryRun ? '[dry run] ' : ''}Done. ${updated} food(s) ${dryRun ? 'would be ' : ''}re-normalized, ` +
      `${repaired} empty USDA food(s) ${dryRun ? 'would be ' : ''}repaired from a refetch, ` +
      `${skipped} had no micronutrients, ${unscalable} skipped (no serving scale)` +
      `${refetchFailed ? `, ${refetchFailed} refetch failed` : ''}` +
      `${missingUsdaKey ? `, ${missingUsdaKey} need USDA_API_KEY to repair` : ''}.`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
