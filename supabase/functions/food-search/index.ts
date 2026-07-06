import { corsHeaders } from '../_shared/cors.ts'
import { getUserId } from '../_shared/auth.ts'
import { logError } from '../_shared/log-error.ts'

// Your USDA FoodData Central API key, set as a Supabase secret (never shipped to
// the browser):  supabase secrets set USDA_API_KEY=...
// Get a free key at https://fdc.nal.usda.gov/api-key-signup
const USDA_API_KEY = Deno.env.get('USDA_API_KEY')

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search'
const DETAIL_URL = 'https://api.nal.usda.gov/fdc/v1/food'

// USDA reports nutrients per 100 g, keyed by a stable "nutrient number":
//   208 = Energy (kcal)   203 = Protein   205 = Carbohydrate   204 = Total fat
const NUTRIENT = { calories: '208', protein: '203', carbs: '205', fat: '204' }

const rateLimited = () =>
  new Response(
    JSON.stringify({
      error: 'The food database is busy right now (rate limit). Try again in a minute.',
    }),
    { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )

// Thin proxy to USDA FoodData Central. Two modes, both keyed off the secret API
// key (never shipped to the browser):
//   • { query }  → text search, returns a trimmed per-100g list of matches.
//   • { fdcId }  → detail lookup for one food, returns per-100g macros PLUS the
//     real-world portions (e.g. "1 large" egg = 50 g) so the UI can rescale
//     macros to whatever unit the user actually eats.
// Pricing is deliberately NOT sourced here — cost stays user-entered.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Require a logged-in user so random callers can't burn the rate limit.
    await getUserId(req)

    if (!USDA_API_KEY) {
      throw new Error(
        'USDA_API_KEY is not set. Run: supabase secrets set USDA_API_KEY=your-key'
      )
    }

    const body = await req.json().catch(() => ({}))

    // ---- detail mode: portions + macros for a single food ----
    if (body.fdcId != null) {
      const id = encodeURIComponent(String(body.fdcId))
      const resp = await fetch(`${DETAIL_URL}/${id}?api_key=${encodeURIComponent(USDA_API_KEY)}`)
      if (resp.status === 429) return rateLimited()
      // Some foods USDA returns in search don't resolve on the detail endpoint
      // (404). That's not an error worth failing on — the caller falls back to
      // weight-based units, so just report "no detail".
      if (resp.status === 404) {
        return new Response(JSON.stringify({ food: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const f = await resp.json()
      if (!resp.ok) throw new Error(f?.error?.message ?? `USDA API error (${resp.status})`)

      // Detail nutrients are nested under `nutrient` (unlike search results).
      const byNumber = new Map(
        (f.foodNutrients ?? []).map((n) => [String(n.nutrient?.number), Number(n.amount) || 0])
      )

      // Full per-100g nutrient profile (all of it, not just the four macros) so
      // the caller can stash it for a future micronutrient feature. USDA reports
      // every nutrient per 100 g. Skip entries with no name or no amount.
      const nutrients = []
      for (const n of f.foodNutrients ?? []) {
        const name = n.nutrient?.name
        const amount = Number(n.amount)
        if (!name || !Number.isFinite(amount)) continue
        nutrients.push({ name, amount, unit: n.nutrient?.unitName ?? '', per: '100g' })
      }

      const portions = []
      for (const p of f.foodPortions ?? []) {
        const grams = Number(p.gramWeight) || 0
        if (grams <= 0) continue
        // String(Number(...)) drops a trailing ".0" so "1.0 large" → "1 large".
        const amount = String(Number(p.amount ?? 1))
        const unit = p.measureUnit?.name
        const modifier = p.modifier || p.portionDescription || (unit && unit !== 'undetermined' ? unit : '')
        const label = [amount, modifier].filter(Boolean).join(' ').trim() || `${grams} g`
        portions.push({ label, grams })
      }
      // Branded foods describe their serving via servingSize + a household text
      // rather than foodPortions.
      if ((f.servingSizeUnit ?? '').toLowerCase() === 'g' && Number(f.servingSize) > 0) {
        portions.push({
          label: f.householdServingFullText || '1 serving',
          grams: Number(f.servingSize),
        })
      }

      return new Response(
        JSON.stringify({
          food: {
            fdcId: String(f.fdcId),
            name: f.description ?? 'Unknown food',
            brand: f.brandName || f.brandOwner || null,
            calories: byNumber.get(NUTRIENT.calories) ?? 0,
            protein: byNumber.get(NUTRIENT.protein) ?? 0,
            carbs: byNumber.get(NUTRIENT.carbs) ?? 0,
            fat: byNumber.get(NUTRIENT.fat) ?? 0,
            portions: portions.slice(0, 10),
            nutrients,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ---- search mode ----
    const q = typeof body.query === 'string' ? body.query.trim() : ''
    if (q.length < 2) {
      // Too short to be a useful search — return empty rather than spend a call.
      return new Response(JSON.stringify({ foods: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resp = await fetch(`${SEARCH_URL}?api_key=${encodeURIComponent(USDA_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        pageSize: 15,
        // Foundation + SR Legacy are the clean generic entries; Branded adds
        // packaged products (which carry a brand name).
        dataType: ['Foundation', 'SR Legacy', 'Branded'],
      }),
    })

    if (resp.status === 429) return rateLimited()

    const data = await resp.json()
    if (!resp.ok) {
      throw new Error(data?.error?.message ?? `USDA API error (${resp.status})`)
    }

    const foods = (data.foods ?? []).map((f) => {
      const byNumber = new Map(
        (f.foodNutrients ?? []).map((n) => [String(n.nutrientNumber), Number(n.value) || 0])
      )
      return {
        fdcId: String(f.fdcId),
        name: f.description ?? 'Unknown food',
        // Branded items carry a brand; generic (Foundation/SR Legacy) don't.
        brand: f.brandName || f.brandOwner || null,
        // Per 100 g, matching what USDA reports.
        calories: byNumber.get(NUTRIENT.calories) ?? 0,
        protein: byNumber.get(NUTRIENT.protein) ?? 0,
        carbs: byNumber.get(NUTRIENT.carbs) ?? 0,
        fat: byNumber.get(NUTRIENT.fat) ?? 0,
      }
    })

    return new Response(JSON.stringify({ foods }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('food-search', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
