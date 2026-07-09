import { supabase } from './supabaseClient'
import { parseJson } from './receipt'
import { normalizeFoodNutrients } from './nutrients'

// Web-search nutrition lookup — the last-resort tier, used only when the food is
// in neither the user's library nor the USDA database. It makes a NESTED call to
// the `chat` Edge Function with Anthropic's server-side web search turned on (the
// `web_search: true` body flag) and a strict-JSON system prompt, so the model
// finds the manufacturer's/retailer's published nutrition and hands back the same
// shape the label scanner produces — plus the source URL it read.
//
// Anthropic runs the search itself and can `pause_turn` mid-search; we just loop,
// resending the (unchanged) assistant turn to resume, until it finishes. Results
// are validated for plausibility before we trust them — implausible numbers are
// rejected rather than shown, so the assistant says "couldn't find reliable data"
// instead of surfacing a hallucinated panel.

const MAX_TOKENS = 3072
const MAX_STEPS = 6

const system = `You look up a packaged food or drink's OFFICIAL published nutrition using web search, and return it as structured data.
Use the web_search tool to find the manufacturer's or a reputable retailer's published Nutrition Facts for the product. Prefer the brand's own site; otherwise a major retailer or a reputable nutrition database.
Respond with ONLY a JSON object — no prose, no markdown code fences. Use exactly this schema:
{
  "product_name": string,       // the product name
  "brand": string|null,         // the brand/manufacturer, or null
  "serving_size": string,       // the serving size, e.g. "1 bar (60 g)", "1 cup (240 mL)"
  "calories": number,           // calories PER SERVING
  "protein": number,            // grams protein PER SERVING
  "carbs": number,              // grams total carbohydrate PER SERVING
  "fat": number,                // grams total fat PER SERVING
  "nutrients": [                // vitamins/minerals PER SERVING that the source lists (Sodium, Vitamin D, Calcium, Iron, Potassium, etc.)
    { "name": string, "amount": number, "unit": string, "amount_normalized_mcg_or_mg": number|null, "percent_dv": number|null }
  ],
  "source_url": string|null,    // the exact page URL you read the numbers from
  "error": string|null          // set a short message if you could NOT find reliable published nutrition; otherwise null
}
Rules:
1. NEVER invent numbers. If you cannot find the product's real published nutrition, set "error" and leave the values empty/zero. It is far better to return an error than to guess.
2. Keep amounts PER SERVING and units as published. Only set "amount_normalized_mcg_or_mg" for the standard IU conversions (Vitamin D 40 IU = 1 mcg; Vitamin E 1 IU = 0.67 mg; Vitamin A 1 IU = 0.3 mcg RAE); otherwise null.
3. Put Sodium in "nutrients", not the macro fields. Do not duplicate protein/carbs/fat inside "nutrients".
4. Always include "source_url" with the page you actually used.`

// Invoke the chat function with web search forced on and no client tools.
async function callWebChat(messages) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('chat', {
    body: { system, messages, web_search: true, max_tokens: MAX_TOKENS },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    let message = error.message
    try {
      const details = await error.context.json()
      if (details?.error) message = details.error
    } catch {
      // keep fallback
    }
    throw new Error(message)
  }
  return data
}

// Look up one product's nutrition on the web. Returns a normalized draft:
//   { product, brand, servingSize, calories, protein, carbs, fat,
//     nutrients: [raw + normalized rows], sourceUrl }
// or throws with a user-facing message when nothing reliable was found.
export async function lookupWebNutrition(product) {
  const q = String(product || '').trim()
  if (!q) throw new Error('Tell me which product to look up.')

  let convo = [
    { role: 'user', content: `Find the official published nutrition facts for: ${q}. Return the JSON described.` },
  ]
  let resp = null
  for (let i = 0; i < MAX_STEPS; i++) {
    resp = await callWebChat(convo)
    convo = [...convo, { role: 'assistant', content: resp.content }]
    // A server-side web search pauses the turn; resend the assistant content to
    // let Anthropic resume its own search. Nothing to execute browser-side.
    if (resp.stop_reason === 'pause_turn') continue
    break
  }

  const text = (resp?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = parseJson(text)
  if (!parsed || parsed.error) {
    throw new Error(
      "I couldn't find reliable published nutrition for that online. You can scan its label or enter it by hand instead."
    )
  }

  const productName = String(parsed.product_name ?? '').trim() || q
  const draft = {
    product: productName,
    brand: parsed.brand ? String(parsed.brand).trim() : '',
    servingSize: String(parsed.serving_size ?? '').trim() || '1 serving',
    calories: Math.max(0, Number(parsed.calories) || 0),
    protein: Math.max(0, Number(parsed.protein) || 0),
    carbs: Math.max(0, Number(parsed.carbs) || 0),
    fat: Math.max(0, Number(parsed.fat) || 0),
    sourceUrl: cleanUrl(parsed.source_url),
    rawRows: Array.isArray(parsed.nutrients)
      ? parsed.nutrients
          .map((n) => ({
            name: String(n?.name ?? '').trim(),
            amount: n?.amount == null || n.amount === '' ? null : Number(n.amount),
            unit: String(n?.unit ?? '').trim(),
            per: 'serving',
            amount_normalized_mcg_or_mg: finiteOrNull(n?.amount_normalized_mcg_or_mg),
            percent_dv: finiteOrNull(n?.percent_dv),
          }))
          .filter((n) => n.name && n.amount != null)
      : [],
  }

  if (!isPlausible(draft)) {
    throw new Error(
      "I found some numbers online but they didn't look trustworthy, so I won't use them. Try scanning the label instead."
    )
  }

  const normalized = normalizeFoodNutrients(draft.rawRows, { source: 'label', servingScale: 1 })
  return {
    product: draft.product,
    brand: draft.brand,
    servingSize: draft.servingSize,
    calories: draft.calories,
    protein: draft.protein,
    carbs: draft.carbs,
    fat: draft.fat,
    sourceUrl: draft.sourceUrl,
    // Raw published rows + canonical id-bearing rows, exactly like a label scan.
    nutrients: [...draft.rawRows, ...normalized],
  }
}

// Reject obviously-wrong extractions rather than surfacing a hallucinated panel:
//  • protein grams can't exceed the serving's total weight in grams;
//  • stated calories must be roughly consistent with 4/4/9 Atwater math.
function isPlausible(draft) {
  const grams = parseServingGrams(draft.servingSize)
  if (grams != null && grams > 0 && draft.protein > grams + 1) return false
  if (draft.fat > 0 && grams != null && grams > 0 && draft.fat > grams + 1) return false

  const atwater = 4 * draft.protein + 4 * draft.carbs + 9 * draft.fat
  if (draft.calories > 0 && atwater > 0) {
    // Generous band — fiber, sugar alcohols, and rounding all shift the sum, but
    // a value off by more than ~60% in either direction is not believable.
    const lo = draft.calories * 0.5 - 40
    const hi = draft.calories * 1.7 + 60
    if (atwater < lo || atwater > hi) return false
  }
  return true
}

function parseServingGrams(desc) {
  const s = String(desc ?? '')
  const paren = s.match(/\(([\d.]+)\s*g\)/i)
  if (paren) return Number(paren[1])
  const trailing = s.match(/([\d.]+)\s*g\b/i)
  if (trailing) return Number(trailing[1])
  return null
}

function cleanUrl(v) {
  const s = String(v ?? '').trim()
  return /^https?:\/\//i.test(s) ? s : ''
}

// The registrable-ish domain of a URL, for a compact "found on brand.com" note.
export function urlDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function finiteOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
