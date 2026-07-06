import { corsHeaders } from '../_shared/cors.ts'
import { getUserId } from '../_shared/auth.ts'
import { logError } from '../_shared/log-error.ts'

// Your USDA FoodData Central API key, set as a Supabase secret (never shipped to
// the browser):  supabase secrets set USDA_API_KEY=...
// Get a free key at https://fdc.nal.usda.gov/api-key-signup
const USDA_API_KEY = Deno.env.get('USDA_API_KEY')

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search'

// USDA reports nutrients per 100 g, keyed by a stable "nutrient number":
//   208 = Energy (kcal)   203 = Protein   205 = Carbohydrate   204 = Total fat
const NUTRIENT = { calories: '208', protein: '203', carbs: '205', fat: '204' }

// Thin proxy to USDA FoodData Central's food search. The frontend sends a text
// query; we add the secret API key, ask USDA for a handful of matches, and
// return a trimmed, per-100g shape the meal tracker can drop straight into a
// foods row. Pricing is deliberately NOT sourced here — cost stays user-entered.
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

    const { query } = await req.json().catch(() => ({ query: '' }))
    const q = typeof query === 'string' ? query.trim() : ''
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

    if (resp.status === 429) {
      // USDA rate limit hit (1,000/hr on a real key, 30/hr on the demo key).
      return new Response(
        JSON.stringify({
          error: 'The food database is busy right now (rate limit). Try again in a minute.',
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
