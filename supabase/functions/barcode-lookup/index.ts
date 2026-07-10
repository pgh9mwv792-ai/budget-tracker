import { corsHeaders } from '../_shared/cors.ts'
import { getUserId } from '../_shared/auth.ts'
import { logError } from '../_shared/log-error.ts'

// Resolve a scanned product barcode (UPC/EAN) to a food. Two sources, tried in
// order and returning the FIRST that has usable macros:
//   1. Open Food Facts — a free, community-maintained product database. No key
//      needed; we send a descriptive User-Agent per their etiquette. Because the
//      data is crowd-edited, the CLIENT re-validates plausibility before saving
//      (see lib/barcode.js `plausibleMacros`) — we just pass through what's there.
//   2. USDA FoodData Central branded search by `gtinUpc` — the same key the
//      food-search function uses. Covers many US packaged foods OFF misses.
//
// Response shape mirrors food-search so the client can reuse its verify-before-
// save flow: per-100g macros + a full per-100g `nutrients` array + serving info,
// plus which source answered.
//   Hit:  { found: true, source: 'off'|'usda', product: {...} }
//   Miss: { found: false }
const USDA_API_KEY = Deno.env.get('USDA_API_KEY')
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search'

// Be a good Open Food Facts citizen: identify the app + a contact so they can
// reach us if a query pattern misbehaves. (Their docs ask for this.)
const OFF_USER_AGENT = 'BudgetTracker/1.0 (budget-tracker-rose-mu.vercel.app)'

// USDA nutrient numbers for the four macros (same as food-search).
const NUTRIENT = { calories: '208', protein: '203', carbs: '205', fat: '204' }

// Open Food Facts nutriment keys → the human nutrient names the client's
// normalizer recognizes by alias (src/lib/nutrients.js). OFF reports each
// `<key>_100g` in the unit given by `<key>_unit` (grams when unspecified), so we
// pass the value + unit straight through and let the client convert g/mg/mcg/IU.
const OFF_NUTRIENTS: Array<[string, string]> = [
  ['fiber', 'Dietary Fiber'],
  ['sugars', 'Total Sugars'],
  ['saturated-fat', 'Saturated Fat'],
  ['trans-fat', 'Trans Fat'],
  ['cholesterol', 'Cholesterol'],
  ['sodium', 'Sodium'],
  ['potassium', 'Potassium'],
  ['calcium', 'Calcium'],
  ['iron', 'Iron'],
  ['magnesium', 'Magnesium'],
  ['zinc', 'Zinc'],
  ['copper', 'Copper'],
  ['selenium', 'Selenium'],
  ['phosphorus', 'Phosphorus'],
  ['iodine', 'Iodine'],
  ['vitamin-a', 'Vitamin A'],
  ['vitamin-c', 'Vitamin C'],
  ['vitamin-d', 'Vitamin D'],
  ['vitamin-e', 'Vitamin E'],
  ['vitamin-k', 'Vitamin K'],
  ['vitamin-b1', 'Thiamin'],
  ['vitamin-b2', 'Riboflavin'],
  ['vitamin-pp', 'Niacin'],
  ['pantothenic-acid', 'Pantothenic acid'],
  ['vitamin-b6', 'Vitamin B6'],
  ['vitamin-b12', 'Vitamin B12'],
  ['folates', 'Folate'],
  ['choline', 'Choline'],
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Require a logged-in user so random callers can't burn OFF/USDA quota.
    await getUserId(req)

    const body = await req.json().catch(() => ({}))
    const upc = String(body.upc ?? '').replace(/\D/g, '')
    if (upc.length < 8) {
      return json({ found: false, error: 'Not a valid barcode.' })
    }

    // ---- 1. Open Food Facts ----
    const off = await lookupOpenFoodFacts(upc)
    if (off) return json({ found: true, source: 'off', product: off })

    // ---- 2. USDA branded search by GTIN/UPC ----
    const usda = await lookupUsdaByUpc(upc)
    if (usda) return json({ found: true, source: 'usda', product: usda })

    return json({ found: false })
  } catch (err) {
    const message = logError('barcode-lookup', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function lookupOpenFoodFacts(upc: string) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
    upc
  )}.json?fields=product_name,brands,serving_size,serving_quantity,nutriments`
  let resp: Response
  try {
    resp = await fetch(url, { headers: { 'User-Agent': OFF_USER_AGENT } })
  } catch {
    return null // network hiccup — fall through to USDA
  }
  if (!resp.ok) return null
  const data = await resp.json().catch(() => null)
  // OFF returns status 0 for "product not found".
  if (!data || data.status !== 1 || !data.product) return null

  const p = data.product
  const nutr = p.nutriments ?? {}
  const kcal = per100(nutr, 'energy-kcal')
  const protein = per100(nutr, 'proteins')
  const carbs = per100(nutr, 'carbohydrates')
  const fat = per100(nutr, 'fat')
  // No usable macros → treat as a miss so USDA gets a shot.
  if (kcal == null && protein == null && carbs == null && fat == null) return null

  const nutrients: Array<Record<string, unknown>> = []
  for (const [key, name] of OFF_NUTRIENTS) {
    const amount = per100(nutr, key)
    if (amount == null) continue
    const unit = String(nutr[`${key}_unit`] ?? 'g')
    nutrients.push({ name, amount, unit, per: '100g' })
  }

  const servingGrams = Number(p.serving_quantity)
  return {
    name: cleanText(p.product_name) || 'Scanned product',
    brand: firstBrand(p.brands),
    upc,
    calories: kcal ?? 0,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
    servingSize: cleanText(p.serving_size) || null,
    servingGrams: Number.isFinite(servingGrams) && servingGrams > 0 ? servingGrams : null,
    // The OFF product page, kept as provenance (stored in foods.source_ref).
    sourceUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(upc)}`,
    fdcId: null,
    nutrients,
  }
}

async function lookupUsdaByUpc(upc: string) {
  if (!USDA_API_KEY) return null
  let resp: Response
  try {
    resp = await fetch(`${USDA_SEARCH_URL}?api_key=${encodeURIComponent(USDA_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: upc, dataType: ['Branded'], pageSize: 25 }),
    })
  } catch {
    return null
  }
  if (!resp.ok) return null
  const data = await resp.json().catch(() => null)
  const foods = data?.foods ?? []
  // USDA search matches the UPC loosely — keep only an exact gtinUpc match so we
  // don't attach the wrong product. Compare on trailing significant digits so a
  // leading-zero difference (UPC-A vs EAN-13) still matches.
  const want = upc.replace(/^0+/, '')
  const f = foods.find((x: Record<string, unknown>) => {
    const g = String(x.gtinUpc ?? '').replace(/\D/g, '').replace(/^0+/, '')
    return g && g === want
  })
  if (!f) return null

  const byNumber = new Map(
    (f.foodNutrients ?? []).map((n: Record<string, unknown>) => [
      String(n.nutrientNumber),
      Number(n.value) || 0,
    ])
  )
  const nutrients: Array<Record<string, unknown>> = []
  for (const n of f.foodNutrients ?? []) {
    const name = n.nutrientName
    const amount = Number(n.value)
    if (!name || !Number.isFinite(amount)) continue
    const usdaNumber = n.nutrientNumber != null ? String(n.nutrientNumber) : null
    nutrients.push({ name, amount, unit: n.unitName ?? '', per: '100g', usda_number: usdaNumber })
  }

  const servingGrams = Number(f.servingSize)
  const gramServing =
    String(f.servingSizeUnit ?? '').toLowerCase() === 'g' && servingGrams > 0 ? servingGrams : null
  return {
    name: cleanText(f.description) || 'Scanned product',
    brand: cleanText(f.brandName || f.brandOwner) || null,
    upc,
    calories: (byNumber.get(NUTRIENT.calories) as number) ?? 0,
    protein: (byNumber.get(NUTRIENT.protein) as number) ?? 0,
    carbs: (byNumber.get(NUTRIENT.carbs) as number) ?? 0,
    fat: (byNumber.get(NUTRIENT.fat) as number) ?? 0,
    servingSize: cleanText(f.householdServingFullText) || (gramServing ? `${gramServing} g` : null),
    servingGrams: gramServing,
    sourceUrl: null,
    // USDA's own id, kept so the food can later be enriched/re-detailed.
    fdcId: f.fdcId != null ? String(f.fdcId) : null,
    nutrients,
  }
}

// OFF stores the standardized per-100g value under `<key>_100g`. Returns a
// finite number or null (so "not reported" stays distinct from a real 0).
function per100(nutriments: Record<string, unknown>, key: string) {
  const v = Number(nutriments[`${key}_100g`])
  return Number.isFinite(v) ? v : null
}

function cleanText(v: unknown) {
  return String(v ?? '').trim()
}

// OFF `brands` is a comma-separated list; the first is the primary maker.
function firstBrand(v: unknown) {
  const s = String(v ?? '').trim()
  if (!s) return null
  return s.split(',')[0].trim() || null
}
