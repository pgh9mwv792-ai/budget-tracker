import { supabase } from './supabaseClient'
import { todayISO } from './dateHelpers'

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
// `maxDim`/`quality` are tunable because a receipt reads fine at a modest size,
// but a dense Supplement Facts panel (tiny print, 20+ rows) needs more pixels and
// less JPEG compression or the model can't make out the numbers.
async function imageBlock(file, { maxDim = 1600, quality = 0.8 } = {}) {
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
  const jpeg = canvas.toDataURL('image/jpeg', quality)
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
// Claude content block. `imageOpts` tunes the downscale for images (see
// imageBlock) — labels pass a higher maxDim/quality than receipts.
export async function fileToContentBlock(file, imageOpts) {
  if (file.type === 'application/pdf') return documentBlock(file)
  if (file.type.startsWith('image/')) return imageBlock(file, imageOpts)
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
  if (!session) throw new Error('Please sign in to use AI features.')
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
export async function parseReceipt({ file, categories = [], today = todayISO() }) {
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

// Sends one OR MORE receipt files to Claude in ITEMIZED mode and returns a
// normalized draft:
//   { store_name, purchase_date, total, items: [{ raw_name, price, quantity,
//     unit, looks_like_food }] }
// The heavier sibling of parseReceipt(): one Claude call, same secure proxy and
// daily cap, but the model transcribes each line rather than just the total.
//
// Multiple images are treated as PAGES of a single receipt — stores like Whole
// Foods print the item list and the totals block on separate slips, so the user
// can add several photos and we transcribe them as one receipt (never double
// counting an item that appears on more than one page).
//
// Accepts `{ files: [File, ...] }` (preferred) or a single `{ file }`.
//
// Contract with the extraction prompt (enforced below):
//   • raw_name stays VERBATIM as printed — the receipt_item_rules table keys off
//     it, so the model must NOT "clean up" or expand names.
//   • total is the FINAL charged amount incl. tax (that's what matches the bank).
//   • looks_like_food is the model's guess; the UI only uses it to pre-check a
//     box — the user decides is_food.
//   • an unreadable image returns { error } and NO invented items.
export async function parseReceiptItemized({ file, files, today = todayISO() }) {
  const list = (files ?? (file ? [file] : [])).filter(Boolean)
  if (!list.length) throw new Error('Add at least one photo of the receipt.')
  const blocks = await Promise.all(list.map(fileToContentBlock))
  const multi = blocks.length > 1

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
5. If the image is not a readable receipt (blurry, wrong photo, cut off), set "error" to a short message and return an empty items array. NEVER invent items or prices.${
    multi
      ? `
6. You were given ${blocks.length} images. They are PAGES OF THE SAME ONE receipt (e.g. the item list on one slip and the totals/tax on another) — NOT separate receipts. Combine them: merge all line items into a single "items" array in printed order, and read store_name/purchase_date/total from whichever page shows them. Do NOT list an item twice if it appears on more than one page.`
      : ''
  }`

  const messages = [
    {
      role: 'user',
      content: [
        ...blocks,
        {
          type: 'text',
          text: multi
            ? `These ${blocks.length} images are pages of ONE receipt. Transcribe them together into a single itemized JSON following the schema exactly.`
            : 'Transcribe this receipt into itemized JSON following the schema exactly.',
        },
      ],
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

// Best-effort JSON extraction from a model reply. Tolerates, in order:
//   1. clean JSON,
//   2. ```json fences and/or a "Here is the JSON:" style preamble,
//   3. a truncated reply (the model hit max_tokens mid-object) — we walk the
//      braces from the first "{" and, if it never closes, synthetically close
//      the open braces/brackets so a partial-but-usable object still parses.
// Returns the parsed object or null. Keeping this defensive matters: the
// supplement/receipt scanners depend entirely on getting an object back, and a
// silent null here is exactly the kind of "scanner does nothing" failure we're
// guarding against.
export function parseJson(text) {
  if (!text) return null

  // Strip code fences anywhere in the string (not just the very start/end) and
  // any prose before the first "{".
  const stripped = text.replace(/```(?:json)?/gi, '').trim()

  const attempt = (s) => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }

  const direct = attempt(stripped)
  if (direct && typeof direct === 'object') return direct

  const start = stripped.indexOf('{')
  if (start === -1) return null

  // Largest balanced object starting at `start`.
  const balanced = extractBalanced(stripped, start)
  if (balanced) {
    const parsed = attempt(balanced)
    if (parsed && typeof parsed === 'object') return parsed
  }

  // Last resort: the reply was cut off. Close whatever is still open so we can
  // salvage the ingredients read so far rather than throwing the whole scan away.
  const repaired = attempt(repairTruncated(stripped.slice(start)))
  return repaired && typeof repaired === 'object' ? repaired : null
}

// Returns the substring from `start` (an opening "{") through its matching close
// brace, respecting strings/escapes, or null if it never balances.
function extractBalanced(s, start) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

// Closes any unterminated string and open braces/brackets for a truncated reply,
// trimming a dangling trailing comma so JSON.parse accepts the salvaged prefix.
function repairTruncated(s) {
  const stack = []
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') stack.pop()
  }
  let out = s
  if (inStr) out += '"'
  out = out.replace(/,\s*$/, '')
  while (stack.length) out += stack.pop()
  return out
}
