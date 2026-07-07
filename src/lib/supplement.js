import { fileToContentBlock, callVision, parseJson } from './receipt'

// Reads a photo (or PDF) of a Supplement/Nutrition Facts panel with Claude and
// returns a normalized, editable draft:
//   { product, brand, servingSize, calories, protein, carbs, fat, ingredients }
// where ingredients is [{ name, amount, unit, amountNormalized, percentDv }].
//
// It reuses the exact same secure pipeline as the receipt scanner: downscale the
// image client-side, send it through the `chat` Edge Function (API key stays
// server-side, same per-user daily cap), and parse strict JSON back. No new cost
// surface. `maxTokens` is raised because a multivitamin can list 20+ ingredients.
const MAX_TOKENS = 4096

// The known IU→metric conversions the model is allowed to normalize. Anything
// else must come back null rather than a guessed value.
const system = `You read a dietary SUPPLEMENT or NUTRITION FACTS panel from an image and extract it as structured data.
Respond with ONLY a JSON object — no prose, no markdown code fences. Use exactly this schema:
{
  "product": string,          // the product name, or "" if not visible
  "brand": string|null,       // the brand/manufacturer, or null if not visible
  "serving_size": string,     // the label's serving size verbatim, e.g. "2 capsules", "1 scoop (30 g)"
  "calories": number,         // calories PER SERVING; 0 if the label lists none
  "protein": number,          // grams of protein PER SERVING; 0 if none
  "carbs": number,            // grams of carbohydrate PER SERVING; 0 if none
  "fat": number,              // grams of fat PER SERVING; 0 if none
  "ingredients": [            // one object per active ingredient row, PER SERVING
    {
      "name": string,         // the ingredient exactly as printed
      "amount": number,       // the numeric amount as printed on the label
      "unit": string,         // the unit as printed, e.g. "mcg", "mg", "g", "IU"
      "amount_normalized_mcg_or_mg": number|null,
      "percent_dv": number|null // the % Daily Value if printed, else null
    }
  ],
  "error": string|null        // set a short human message if this is NOT a readable supplement/nutrition panel; otherwise null
}

Rules — follow exactly:
1. Capture EVERY row of the Supplement Facts panel, even if the panel is tiny (a single-mineral pill may list just one or two rows, e.g. Zinc and Copper). Never skip a mineral or vitamin because its amount is small.
2. ALWAYS include the base nutrient name, and PRESERVE the chemical form. Write it as "<Nutrient> (as <form>)" — e.g. "Zinc (as zinc glycinate)", "Copper (as copper glycinate)", "Vitamin B12 (as methylcobalamin)". If the label prints only the chemical form (e.g. just "Copper Glycinate"), still infer and lead with the base nutrient: "Copper (as copper glycinate)". Never return an empty "name".
3. Keep the label's LITERAL amount and unit in "amount"/"unit". Additionally set "amount_normalized_mcg_or_mg" ONLY for these known standard IU conversions:
     - Vitamin D / D3: 40 IU = 1 mcg  (normalized value in mcg)
     - Vitamin E: 1 IU = 0.67 mg d-alpha-tocopherol  (normalized value in mg)
     - Vitamin A: 1 IU = 0.3 mcg RAE  (normalized value in mcg)
   If the unit is already mcg/mg/g, OR the conversion is not one of the standards above, set "amount_normalized_mcg_or_mg" to null. NEVER invent or guess a conversion.
4. PROPRIETARY BLENDS (e.g. "Immune Complex 450 mg" with no per-ingredient breakdown): capture the blend as a SINGLE ingredient using the blend's name and total amount. Do NOT invent the individual ingredients or split the total.
5. If the image is not a readable Supplement Facts / Nutrition Facts panel (blurry, wrong kind of photo, unreadable), set "error" to a short message and return empty/zero values elsewhere. Do NOT hallucinate ingredient values.`

export async function parseSupplement({ file }) {
  // A Supplement Facts panel is dense fine print, so send more pixels and less
  // JPEG compression than the receipt scanner uses (whose default is fine for
  // big storefront text) — a too-degraded image is a common "reads nothing"
  // cause.
  const block = await fileToContentBlock(file, { maxDim: 2200, quality: 0.92 })

  const messages = [
    {
      role: 'user',
      content: [block, { type: 'text', text: 'Extract this supplement label as JSON following the schema exactly.' }],
    },
  ]

  const resp = await callVision(system, messages, MAX_TOKENS)
  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = parseJson(text)
  if (!parsed) {
    // Surface what the model actually said so a failure is diagnosable in Sentry
    // (the caller reports it) instead of a dead-end "does nothing".
    const err = new Error('Could not read that label. Try a clearer, well-lit photo of the Supplement Facts panel.')
    err.rawResponse = text.slice(0, 500)
    throw err
  }
  if (parsed.error) throw new Error(String(parsed.error))

  const ingredients = Array.isArray(parsed.ingredients)
    ? parsed.ingredients
        .map((ing) => ({
          name: String(ing?.name ?? '').trim(),
          amount: numOrEmpty(ing?.amount),
          unit: String(ing?.unit ?? '').trim(),
          amountNormalized: finiteOrNull(ing?.amount_normalized_mcg_or_mg),
          percentDv: finiteOrNull(ing?.percent_dv),
        }))
        // Keep any row the reader got an amount for even if it missed the name,
        // so the review card surfaces it (with a "not counted" flag) for the user
        // to name — rather than silently dropping a nutrient it half-read.
        .filter((ing) => ing.name || ing.amount !== '')
    : []

  if (!ingredients.length && !String(parsed.product ?? '').trim()) {
    throw new Error('No ingredients found. Make sure the Supplement Facts panel is fully in frame.')
  }

  return {
    product: String(parsed.product ?? '').trim(),
    brand: parsed.brand ? String(parsed.brand).trim() : '',
    servingSize: String(parsed.serving_size ?? '').trim(),
    calories: Math.max(0, Number(parsed.calories) || 0),
    protein: Math.max(0, Number(parsed.protein) || 0),
    carbs: Math.max(0, Number(parsed.carbs) || 0),
    fat: Math.max(0, Number(parsed.fat) || 0),
    ingredients,
  }
}

// A blank amount is allowed (proprietary blend rows sometimes omit it) — keep it
// as '' so the review input shows empty rather than a misleading 0.
function numOrEmpty(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : ''
}

function finiteOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
