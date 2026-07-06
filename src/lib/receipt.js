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
