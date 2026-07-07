// One-time backfill: re-normalize the `nutrients` jsonb on every existing food.
//
// WHY: foods saved before the micronutrient feature stored only RAW nutrient rows
// (USDA per-100g rows, or supplement ingredient rows). This script adds the
// CANONICAL per-serving rows (each carrying an `id`) next to them, so old foods
// contribute to the day's micronutrient totals just like newly-saved ones. New
// foods already get both, so this is only needed once for the back catalog.
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

async function main() {
  const { data: foods, error } = await supabase
    .from('foods')
    .select('id, name, source, calories, serving_desc, nutrients')

  if (error) {
    console.error('Could not read foods:', error.message)
    process.exit(1)
  }

  let updated = 0
  let skipped = 0
  let unscalable = 0

  for (const food of foods) {
    const raw = rawOnly(food.nutrients)
    if (raw.length === 0) {
      skipped++ // no raw micronutrients to normalize (e.g. hand-entered foods)
      continue
    }

    const scale = servingScaleForFood(food)
    if (scale == null) {
      // USDA food with no way to recover its per-serving scale — leave it as-is
      // rather than store wrong amounts. Rare; logged so you can eyeball them.
      unscalable++
      console.warn(`  ! skipped (no serving scale): ${food.name} [${food.id}]`)
      continue
    }

    const normalized = normalizeFoodNutrients(raw, { source: food.source, servingScale: scale })
    const next = [...raw, ...normalized]

    if (dryRun) {
      updated++
      continue
    }

    const { error: upErr } = await supabase.from('foods').update({ nutrients: next }).eq('id', food.id)
    if (upErr) {
      console.error(`  ! failed to update ${food.name} [${food.id}]:`, upErr.message)
      continue
    }
    updated++
  }

  console.log(
    `${dryRun ? '[dry run] ' : ''}Done. ${updated} food(s) ${dryRun ? 'would be ' : ''}re-normalized, ` +
      `${skipped} had no micronutrients, ${unscalable} skipped (no serving scale).`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
