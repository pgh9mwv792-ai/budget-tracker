import { supabase } from './supabaseClient'

const MAX_PDF_BYTES = 8 * 1024 * 1024 // Anthropic accepts fairly large PDFs; keep a sane cap.

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })
}

// Reads an image File, downscales it (big phone photos/screenshots are megabytes
// and cost more tokens than they need), and returns a Claude image content block.
async function imageBlock(file, maxDim = 1600) {
  const dataUrl = await readDataUrl(file)
  const img = await new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('That file does not look like an image.'))
    im.src = dataUrl
  })

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(img, 0, 0, width, height)
  const jpeg = canvas.toDataURL('image/jpeg', 0.8)
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.split(',')[1] } }
}

// A PDF (emailed or downloaded digital receipt) goes to Claude as a document
// block — the model reads the pages directly, no image conversion needed.
async function documentBlock(file) {
  if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is too large — try a single-receipt PDF.')
  const dataUrl = await readDataUrl(file)
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataUrl.split(',')[1] } }
}

// Turns any supported receipt file (photo, screenshot, or PDF) into the right
// Claude content block.
export async function fileToContentBlock(file) {
  if (file.type === 'application/pdf') return documentBlock(file)
  if (file.type.startsWith('image/')) return imageBlock(file)
  throw new Error('Please upload a photo, a screenshot, or a PDF receipt.')
}

// Invokes the existing `chat` Edge Function WITHOUT tools — we just want Claude
// to read the image and return JSON, not call any app tools. Reuses the same
// secure proxy (API key stays server-side) and daily rate limit as the chat.
// `maxTokens` is optional — bump it when the model must return a long JSON
// payload (e.g. a supplement label's full ingredient list). The chat function
// clamps it server-side.
export async function callVision(system, messages, maxTokens) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('chat', {
    body: { system, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    // The function's real error body (e.g. the rate-limit notice) is hidden on a
    // non-2xx status — dig it out of error.context.
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

// Sends a receipt file (photo, screenshot, or PDF) to Claude and returns a
// normalized draft transaction: { merchant, date, amount, category, confidence }.
// `category` is either one of the user's expense-category names or null.
export async function parseReceipt({ file, categories = [], today = new Date().toISOString().slice(0, 10) }) {
  const expenseCats = categories.filter((c) => c.kind === 'expense').map((c) => c.name)
  const block = await fileToContentBlock(file)

  const system = `You extract structured data from a photo of a store purchase receipt.
Respond with ONLY a JSON object — no prose, no markdown code fences. Use this schema:
{
  "merchant": string,          // store/business name, best guess, or "" if unreadable
  "date": "YYYY-MM-DD",        // the purchase date; if not visible, use "${today}"
  "total": number,             // the FINAL amount paid after tax, as a positive number
  "category": string|null,     // MUST be exactly one of the allowed categories below, or null if none fit
  "confidence": "high"|"low"   // "low" if the image is blurry, partial, or hard to read
}
Allowed categories: ${expenseCats.join(', ') || '(none provided)'}.
Choose the single best category for the whole receipt based on the merchant and items. If nothing fits, use null.`

  const messages = [
    {
      role: 'user',
      content: [block, { type: 'text', text: 'Extract this receipt as JSON following the schema exactly.' }],
    },
  ]

  const resp = await callVision(system, messages)
  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = parseJson(text)
  if (!parsed) throw new Error('Could not read that receipt. Try a clearer, well-lit photo.')

  const total = Number(parsed.total)
  const category =
    expenseCats.find((n) => n.toLowerCase() === String(parsed.category || '').toLowerCase()) || null

  return {
    merchant: String(parsed.merchant || '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today,
    amount: Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : '',
    category,
    confidence: parsed.confidence === 'low' ? 'low' : 'high',
  }
}

// A receipt can list dozens of line items, so the itemized mode needs a larger
// token budget than the single-total simple mode (the chat function clamps it).
const ITEMIZED_MAX_TOKENS = 4096

// Sends a receipt file to Claude in ITEMIZED mode and returns a normalized draft:
//   { store_name, purchase_date, total, items: [{ raw_name, price, quantity,
//     unit, looks_like_food }] }
// The heavier sibling of parseReceipt(): one Claude call, same secure proxy and
// daily cap, but the model transcribes each line rather than just the total.
//
// Contract with the extraction prompt (enforced below):
//   • raw_name stays VERBATIM as printed — the receipt_item_rules table keys off
//     it, so the model must NOT "clean up" or expand names.
//   • total is the FINAL charged amount incl. tax (that's what matches the bank).
//   • looks_like_food is the model's guess; the UI only uses it to pre-check a
//     box — the user decides is_food.
//   • an unreadable image returns { error } and NO invented items.
export async function parseReceiptItemized({ file, today = new Date().toISOString().slice(0, 10) }) {
  const block = await fileToContentBlock(file)

  const system = `You transcribe a store purchase receipt into structured, itemized data.
Respond with ONLY a JSON object — no prose, no markdown code fences. Use exactly this schema:
{
  "store_name": string,        // the store/business name as printed, or "" if unreadable
  "purchase_date": "YYYY-MM-DD",// the purchase date; if not visible, use "${today}"
  "total": number,             // the FINAL amount charged INCLUDING tax, positive
  "items": [                   // one object per printed line item, in order
    {
      "raw_name": string,      // the item text EXACTLY as printed (do not clean, expand, or fix spelling)
      "price": number,         // the line's price; negative for a discount/coupon line
      "quantity": number|null, // the printed quantity/weight if shown (e.g. 1.2 for "1.2 lb"), else null
      "unit": string|null,     // the unit if shown: "lb", "oz", or "each"; else null
      "looks_like_food": boolean // your best guess whether this is a grocery FOOD item
    }
  ],
  "error": string|null         // set a short human message if this is NOT a readable receipt; otherwise null
}

Rules — follow exactly:
1. raw_name is VERBATIM. "365 ORG CHKN BRST" stays "365 ORG CHKN BRST" — never expand abbreviations, fix casing, or invent a cleaner name. The app keys a memory off this exact text.
2. total is the final charged amount AFTER tax — the number the bank actually charged. Not the subtotal.
3. Coupons/discounts: if a discount is clearly attached to one item, fold it into that item's price (show the net price). Otherwise include the discount as its own line with a NEGATIVE price and looks_like_food:false, so the items still sum to total.
4. Whole Foods and similar stores sell non-food too (soap, supplements, household). Set looks_like_food honestly per line — it only pre-checks a box for the user.
5. If the image is not a readable receipt (blurry, wrong photo, cut off), set "error" to a short message and return an empty items array. NEVER invent items or prices.`

  const messages = [
    {
      role: 'user',
      content: [block, { type: 'text', text: 'Transcribe this receipt into itemized JSON following the schema exactly.' }],
    },
  ]

  const resp = await callVision(system, messages, ITEMIZED_MAX_TOKENS)
  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = parseJson(text)
  if (!parsed) throw new Error('Could not read that receipt. Try a clearer, well-lit photo.')
  if (parsed.error) throw new Error(String(parsed.error))

  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((it) => ({
          raw_name: String(it?.raw_name ?? '').trim(),
          price: finiteOrNull(it?.price),
          quantity: finiteOrNull(it?.quantity),
          unit: normalizeUnit(it?.unit),
          looks_like_food: it?.looks_like_food === true,
        }))
        .filter((it) => it.raw_name)
    : []

  if (!items.length) {
    throw new Error('No line items found. Make sure the whole receipt is in frame and readable.')
  }

  const total = Number(parsed.total)
  return {
    store_name: String(parsed.store_name ?? '').trim(),
    purchase_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.purchase_date) ? parsed.purchase_date : today,
    total: Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : '',
    items,
  }
}

function finiteOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Constrain the unit to the three the schema allows; anything else → null.
function normalizeUnit(v) {
  const u = String(v ?? '').trim().toLowerCase()
  if (u === 'lb' || u === 'lbs') return 'lb'
  if (u === 'oz') return 'oz'
  if (u === 'each' || u === 'ea') return 'each'
  return null
}

// Best-effort JSON extraction — tolerates stray prose or ```json fences.
export function parseJson(text) {
  if (!text) return null
  const cleaned = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through
  }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {
      // give up
    }
  }
  return null
}
