import { fileToContentBlock, callVision, parseJson } from './receipt'

// Reads a photo (or PDF) of a packaged food's NUTRITION FACTS panel with Claude
// and returns a normalized, editable draft:
//   { product, brand, servingSize, servingsPerContainer,
//     calories, protein, carbs, fat,
//     nutrients: [{ name, amount, unit, amountNormalized, percentDv }] }
// where `nutrients` are the micronutrient rows printed on the panel (Sodium,
// Vitamin D, Calcium, Iron, Potassium, and any others the label lists).
//
// This is the food sibling of parseSupplement(): it reuses the exact same secure
// vision pipeline — downscale the image client-side, send it through the `chat`
// Edge Function (API key stays server-side, same per-user daily cap), parse
// strict JSON back — so there is no new cost surface. maxTokens is raised because
// a full panel can carry a dozen-plus micronutrient rows.
const MAX_TOKENS = 4096

const system = `You read a packaged food's NUTRITION FACTS panel from an image and extract it as structured data.
Respond with ONLY a JSON object — no prose, no markdown code fences. Use exactly this schema:
{
  "product_name": string,       // the product name, or "" if not visible
  "brand": string|null,         // the brand/manufacturer, or null if not visible
  "serving_size": string,       // the label's serving size verbatim, e.g. "2 eggs (100 g)", "1 cup (240 mL)"
  "servings_per_container": number|null, // servings per container if printed, else null
  "calories": number,           // calories PER SERVING; 0 if the label lists none
  "protein": number,            // grams of protein PER SERVING; 0 if none
  "carbs": number,              // grams of total carbohydrate PER SERVING; 0 if none
  "fat": number,                // grams of total fat PER SERVING; 0 if none
  "nutrients": [                // one object per vitamin/mineral row, PER SERVING
    {
      "name": string,           // the nutrient exactly as printed, e.g. "Sodium", "Vitamin D", "Calcium", "Iron", "Potassium"
      "amount": number,         // the numeric amount as printed on the label
      "unit": string,           // the unit as printed, e.g. "mcg", "mg", "g", "IU"
      "amount_normalized_mcg_or_mg": number|null,
      "percent_dv": number|null // the % Daily Value if printed, else null
    }
  ],
  "error": string|null          // set a short human message if this is NOT a readable nutrition facts panel; otherwise null
}

Rules — follow exactly:
1. Capture EVERY vitamin/mineral row printed in the lower part of the panel — at minimum the four the US label mandates (Vitamin D, Calcium, Iron, Potassium) whenever they appear, plus Sodium, and any others the label lists (magnesium, zinc, folate, the B vitamins, vitamin A/C/E, etc.). Sodium goes in "nutrients", NOT in the macro fields.
2. Keep the calorie and macro fields (calories/protein/carbs/fat) for the panel's top section. Do NOT also duplicate protein/carbs/fat as rows inside "nutrients".
3. ALWAYS include the base nutrient name exactly as printed. Never return an empty "name".
4. Keep the label's LITERAL amount and unit in "amount"/"unit". Additionally set "amount_normalized_mcg_or_mg" ONLY for these known standard IU conversions:
     - Vitamin D / D3: 40 IU = 1 mcg  (normalized value in mcg)
     - Vitamin E: 1 IU = 0.67 mg d-alpha-tocopherol  (normalized value in mg)
     - Vitamin A: 1 IU = 0.3 mcg RAE  (normalized value in mcg)
   If the unit is already mcg/mg/g, OR the conversion is not one of the standards above, set "amount_normalized_mcg_or_mg" to null. NEVER invent or guess a conversion.
5. If a row prints ONLY a % Daily Value with no absolute amount, set "amount" to that % Daily Value's number, leave "unit" as "" — but PREFER the printed absolute amount whenever one is shown.
6. If a SECOND image is provided, it is the FRONT of the package — use it ONLY to fill "product_name"/"brand" if the facts panel didn't show them. Never read nutrient numbers from the front image.
7. If the image is not a readable Nutrition Facts panel (blurry, wrong kind of photo, unreadable), set "error" to a short message and return empty/zero values elsewhere. Do NOT hallucinate nutrient values.`

export async function parseFoodLabel({ file, frontFile = null }) {
  // A Nutrition Facts panel is dense fine print, so send more pixels and less
  // JPEG compression than the receipt scanner (whose default is fine for big
  // storefront text) — a too-degraded image is a common "reads nothing" cause.
  const block = await fileToContentBlock(file, { maxDim: 2200, quality: 0.92 })
  const content = [block]
  if (frontFile) {
    const front = await fileToContentBlock(frontFile, { maxDim: 1600, quality: 0.85 })
    content.push(front)
    content.push({
      type: 'text',
      text: 'The first image is the Nutrition Facts panel. The second image is the FRONT of the package — use it only to fill the product name and brand. Extract as JSON following the schema exactly.',
    })
  } else {
    content.push({ type: 'text', text: 'Extract this nutrition facts panel as JSON following the schema exactly.' })
  }

  const messages = [{ role: 'user', content }]

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
    const err = new Error('Could not read that label. Try a clearer, well-lit photo of the Nutrition Facts panel.')
    err.rawResponse = text.slice(0, 500)
    throw err
  }
  if (parsed.error) throw new Error(String(parsed.error))

  const nutrients = Array.isArray(parsed.nutrients)
    ? parsed.nutrients
        .map((n) => ({
          name: String(n?.name ?? '').trim(),
          amount: numOrEmpty(n?.amount),
          unit: String(n?.unit ?? '').trim(),
          amountNormalized: finiteOrNull(n?.amount_normalized_mcg_or_mg),
          percentDv: finiteOrNull(n?.percent_dv),
        }))
        // Keep any row the reader got an amount for even if it missed the name,
        // so the review card surfaces it (with a "not counted" flag) for the user
        // to name — rather than silently dropping a nutrient it half-read.
        .filter((n) => n.name || n.amount !== '')
    : []

  const product = String(parsed.product_name ?? '').trim()
  if (!nutrients.length && !product) {
    throw new Error('No nutrition info found. Make sure the Nutrition Facts panel is fully in frame.')
  }

  return {
    product,
    brand: parsed.brand ? String(parsed.brand).trim() : '',
    servingSize: String(parsed.serving_size ?? '').trim(),
    servingsPerContainer: finiteOrNull(parsed.servings_per_container),
    calories: Math.max(0, Number(parsed.calories) || 0),
    protein: Math.max(0, Number(parsed.protein) || 0),
    carbs: Math.max(0, Number(parsed.carbs) || 0),
    fat: Math.max(0, Number(parsed.fat) || 0),
    nutrients,
  }
}

// A blank amount is allowed — keep it as '' so the review input shows empty
// rather than a misleading 0.
function numOrEmpty(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : ''
}

function finiteOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
