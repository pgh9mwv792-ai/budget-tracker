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
1. PRESERVE the chemical form in the ingredient name. "Zinc (as zinc glycinate)" stays "Zinc (as zinc glycinate)", not just "Zinc". "Vitamin B12 (as methylcobalamin)" keeps the form.
2. Keep the label's LITERAL amount and unit in "amount"/"unit". Additionally set "amount_normalized_mcg_or_mg" ONLY for these known standard IU conversions:
     - Vitamin D / D3: 40 IU = 1 mcg  (normalized value in mcg)
     - Vitamin E: 1 IU = 0.67 mg d-alpha-tocopherol  (normalized value in mg)
     - Vitamin A: 1 IU = 0.3 mcg RAE  (normalized value in mcg)
   If the unit is already mcg/mg/g, OR the conversion is not one of the standards above, set "amount_normalized_mcg_or_mg" to null. NEVER invent or guess a conversion.
3. PROPRIETARY BLENDS (e.g. "Immune Complex 450 mg" with no per-ingredient breakdown): capture the blend as a SINGLE ingredient using the blend's name and total amount. Do NOT invent the individual ingredients or split the total.
4. If the image is not a readable Supplement Facts / Nutrition Facts panel (blurry, wrong kind of photo, unreadable), set "error" to a short message and return empty/zero values elsewhere. Do NOT hallucinate ingredient values.`

export async function parseSupplement({ file }) {
  const block = await fileToContentBlock(file)

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
  if (!parsed) throw new Error('Could not read that label. Try a clearer, well-lit photo of the Supplement Facts panel.')
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
        .filter((ing) => ing.name)
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
