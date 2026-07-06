// ---------------------------------------------------------------------------
// Pure, Supabase-free matching + normalization helpers for receipt itemization.
// Kept deliberately dependency-light (only date math) so they are unit-testable
// and identical in the browser and in a test runner. No I/O, no React.
// ---------------------------------------------------------------------------

// Plaid posts a purchase a few days after the swipe (pending → posted), so a
// receipt dated the 3rd can match a transaction whose POSTED date is the 3rd–7th.
const POST_LAG_DAYS = 4
// When the bank descriptor tells us the actual AUTHORIZED date, that IS the
// purchase date — it should equal the receipt date, so we only allow a day of
// slack (strict) / three days (loose) rather than the whole posting window.
const AUTH_DATE_TOL = 1
const AUTH_DATE_TOL_LOOSE = 3
// Amount tolerance: a receipt total and its bank charge legitimately differ when
// a store coupon lowers the charge or tax pushes it up. Allow the LARGER of $8
// or 10% of the receipt total. Anything past this is never a candidate.
const AMOUNT_TOL_CENTS_FLOOR = 800
const AMOUNT_TOL_FRACTION = 0.1
// Merchant similarity at/above this counts as a real merchant match.
const MERCHANT_MATCH_MIN = 0.3

// Generic descriptor noise that carries no merchant identity — bank strings are
// littered with these, so they must not count as "shared tokens". Includes the
// two-letter US state/territory codes (a trailing state abbreviation is location,
// not identity).
const GENERIC_TOKENS = new Set([
  'PURCHASE', 'AUTHORIZED', 'AUTH', 'ON', 'CARD', 'DEBIT', 'CREDIT', 'POS',
  'POINT', 'OF', 'SALE', 'TRANSACTION', 'TXN', 'PMT', 'PAYMENT', 'PENDING',
  'RECURRING', 'ONLINE', 'STORE', 'THE', 'AND', 'LLC', 'INC', 'CO', 'US', 'USA',
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
])

// Normalizes a store/merchant string into the MEANINGFUL tokens that identify
// the business. Uppercases, splits on non-alphanumerics, then drops: 1-char
// noise, any token containing a digit (store numbers like "#10234" / "4432",
// SKU-ish "T1234"), and generic descriptor words (PURCHASE, ON, state codes…).
// This is what makes "WHOLEFDS #10234 CA PURCHASE" and "Whole Foods Market"
// comparable without a fuzzy-match dependency. Returns { compact, tokens } —
// compact (tokens joined) for substring/prefix tests, tokens for overlap scoring.
export function normalizeMerchant(s) {
  const tokens = String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(
      (t) =>
        t.length >= 2 && // drop 1-char noise ("#", stray letters)
        !/\d/.test(t) && // drop store numbers and SKU-ish tokens (any digit)
        !GENERIC_TOKENS.has(t) // drop generic descriptor words + state codes
    )
  return { compact: tokens.join(''), tokens }
}

// Similarity in [0,1] between a receipt store name and a transaction's
// note/merchant text. Bank descriptors abbreviate ("WHOLEFDS" for "Whole
// Foods"), so exact substring/token equality isn't enough — we also credit a
// long shared prefix and prefix-tolerant token overlap ("WHOLE" ⊂ "WHOLEFDS").
// No external fuzzy library needed.
export function merchantSimilarity(storeName, txnText) {
  const a = normalizeMerchant(storeName)
  const b = normalizeMerchant(txnText)
  if (!a.compact || !b.compact) return 0

  let score = 0
  // Exact containment (bank truncation with a store number appended) is the
  // strongest signal; otherwise fall back to a long shared prefix, which catches
  // dropped-vowel abbreviations that neither string fully contains.
  const shorter = a.compact.length <= b.compact.length ? a.compact : b.compact
  const longer = a.compact.length <= b.compact.length ? b.compact : a.compact
  if (shorter.length >= 4 && longer.includes(shorter)) {
    score += 0.5
  } else {
    const prefix = commonPrefixLength(a.compact, b.compact)
    if (prefix >= 5) score += 0.5
    else if (prefix >= 4) score += 0.3
  }

  // Token overlap with prefix tolerance: a receipt word matches a bank word when
  // one is a prefix of the other ("WHOLE" vs "WHOLEFDS", "MARKET" vs "MKT" fails
  // but "TRADER" vs "TRADERJOES" works). Scaled by the smaller token count so a
  // noisy multi-token bank string doesn't dilute a clean 2-word store name.
  if (a.tokens.length && b.tokens.length) {
    let shared = 0
    for (const ta of a.tokens) {
      if (b.tokens.some((tb) => tokensMatch(ta, tb))) shared++
    }
    score += 0.5 * (shared / Math.min(a.tokens.length, b.tokens.length))
  }
  return Math.min(1, score)
}

// Length of the shared leading run of two strings.
function commonPrefixLength(x, y) {
  const n = Math.min(x.length, y.length)
  let i = 0
  while (i < n && x[i] === y[i]) i++
  return i
}

// Two normalized tokens match on equality or when the shorter (≥3 chars) is a
// prefix of the longer — tolerating grocery-descriptor abbreviation.
function tokensMatch(x, y) {
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 3 && long.startsWith(short)
}

// Cents-safe equality: numeric(12,2) money compared as integer cents.
function toCents(n) {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
}

// Everything on a transaction we mine for the merchant name / descriptor.
export function txnDescriptorText(t) {
  return [t?.merchant_name, t?.note, t?.name].filter(Boolean).join(' ')
}

const PAD2 = (n) => String(n).padStart(2, '0')

// descriptorPurchaseDate(text, postedIso): pull the true purchase date out of a
// bank descriptor. Cards print "AUTHORIZED ON 06/28" (or "ON 06/28/25") — that
// is when the card was swiped, i.e. the real purchase date, which the posted
// date lags by a few days. Returns 'YYYY-MM-DD' or null.
//
// Year handling: if the descriptor carries a year ("/25" or "/2025") use it;
// otherwise infer from the posted date. A purchase can't post before it happens,
// so if pinning the posted year lands the descriptor AFTER the posted date it
// must belong to the previous year — the Dec-purchase / Jan-post boundary.
export function descriptorPurchaseDate(text, postedIso) {
  const m = String(text ?? '')
    .toUpperCase()
    .match(/\bON\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/)
  if (!m) return null
  const mm = Number(m[1])
  const dd = Number(m[2])
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null

  let yy
  if (m[3]) {
    yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  } else {
    const posted = Date.parse(`${postedIso}T00:00:00Z`)
    if (Number.isNaN(posted)) return null
    yy = new Date(posted).getUTCFullYear()
    // If this date with the posted year is after the posted date, roll back a
    // year (purchase in December, posted in January).
    if (Date.UTC(yy, mm - 1, dd) > posted) yy -= 1
  }
  const iso = `${yy}-${PAD2(mm)}-${PAD2(dd)}`
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

// The date signal for one transaction vs the receipt's purchase date. Prefers
// the descriptor's authorized date (which should equal the receipt date) and
// otherwise uses the posted date with the 0..+POST_LAG_DAYS posting window.
// Returns { source, gap, matches (strict), close (loose) }.
function dateSignal(receiptIso, t) {
  const authIso = descriptorPurchaseDate(txnDescriptorText(t), t?.date)
  if (authIso) {
    const gap = Math.abs(daysBetweenIso(receiptIso, authIso))
    return { source: 'authorized', gap, matches: gap <= AUTH_DATE_TOL, close: gap <= AUTH_DATE_TOL_LOOSE }
  }
  // Posted date lags the purchase: gap = posted - receipt, expected 0..+lag.
  const gap = daysBetweenIso(receiptIso, t?.date)
  return {
    source: 'posted',
    gap,
    matches: gap >= 0 && gap <= POST_LAG_DAYS,
    close: gap >= 0 && gap <= POST_LAG_DAYS + 1,
  }
}

// -----------------------------------------------------------------------------
// rankTransactionMatches(receipt, transactions, opts)
//
// receipt: { total, purchase_date ('YYYY-MM-DD'), store_name }
// transactions: the array already loaded in App.jsx (each { id, date, amount,
//   kind, source, note/merchant_name }).
// opts.alreadyMatchedIds: iterable of transaction ids already claimed by another
//   receipt — excluded from every candidate list.
//
// Returns { matches, nearMisses } where each entry is
//   { transaction, similarity, dayGap, confidence, reason, receiptTotal,
//     txnAmount, amountDelta, dateSource }.
//   • matches   = HIGH confidence: exact amount + merchant + date. Safe to
//     pre-select for a one-tap confirm.
//   • nearMisses = MEDIUM confidence: merchant + date but the amount wobbles
//     within tolerance (coupon/tax), OR an exact amount we couldn't fully
//     corroborate. Shown with an explanation; never auto-selected.
//
// Hard rules (never bent):
//   • only source='plaid', kind='expense', not already receipt-matched.
//   • amounts outside tolerance (max($8, 10%)) are NEVER candidates.
//   • a non-exact amount REQUIRES a merchant match.
//   • an exact amount whose merchant clearly conflicts (different store) is
//     excluded — a coincidental same-amount charge is not a match.
//   • nothing that fails these becomes a "best guess": both lists come back
//     empty rather than surfacing a bad match.
// Pure: no Supabase, no mutation of inputs.
// -----------------------------------------------------------------------------
export function rankTransactionMatches(receipt, transactions = [], opts = {}) {
  const excluded = new Set([...(opts.alreadyMatchedIds ?? [])].map(String))
  const wantCents = toCents(receipt?.total)
  const date = receipt?.purchase_date
  const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  if (!Number.isFinite(wantCents) || wantCents <= 0 || !validDate) {
    return { matches: [], nearMisses: [] }
  }

  const tolCents = Math.max(AMOUNT_TOL_CENTS_FLOOR, Math.round(wantCents * AMOUNT_TOL_FRACTION))
  const storeTokens = normalizeMerchant(receipt?.store_name).tokens.length

  const matches = []
  const nearMisses = []

  for (const t of transactions) {
    if (!t || excluded.has(String(t.id))) continue
    // Only Plaid expenses are candidates — the receipt annotates real bank money.
    if (t.source !== 'plaid' || t.kind !== 'expense') continue

    const txnCents = toCents(t.amount)
    if (!Number.isFinite(txnCents)) continue
    const centsDiff = Math.abs(txnCents - wantCents)
    const amountExact = centsDiff === 0
    const amountNear = !amountExact && centsDiff <= tolCents
    // Amount outside tolerance → never a candidate, whatever else lines up.
    if (!amountExact && !amountNear) continue

    const similarity = merchantSimilarity(receipt?.store_name, txnDescriptorText(t))
    const merchantMatches = similarity >= MERCHANT_MATCH_MIN
    // "Comparable" only when both sides have meaningful tokens to compare; a
    // conflict (mismatch) is distinct from simply having nothing to compare.
    const comparable = storeTokens > 0 && normalizeMerchant(txnDescriptorText(t)).tokens.length > 0
    const merchantMismatch = comparable && !merchantMatches

    // Hard rules on the merchant signal.
    if (amountNear && !merchantMatches) continue // coupon/tax wobble needs a name match
    if (amountExact && merchantMismatch) continue // exact amount at a different store ≠ match

    const ds = dateSignal(date, t)
    if (!ds.close) continue // outside even the loose date window

    const high = amountExact && merchantMatches && ds.matches
    const amountDelta = (txnCents - wantCents) / 100
    const entry = {
      transaction: t,
      similarity,
      dayGap: ds.gap,
      dateSource: ds.source,
      confidence: high ? 'high' : 'medium',
      receiptTotal: wantCents / 100,
      txnAmount: txnCents / 100,
      amountDelta,
      reason: high
        ? 'exact amount, merchant & date match'
        : amountNear
          ? amountDelta < 0
            ? 'charged less — a coupon likely explains the gap'
            : 'charged more — tax likely explains the gap'
          : 'exact amount, needs a quick confirm',
    }
    ;(high ? matches : nearMisses).push(entry)
  }

  // Best first: higher merchant similarity, then closer amount, then closer date.
  const rank = (a, b) =>
    b.similarity - a.similarity ||
    Math.abs(a.amountDelta) - Math.abs(b.amountDelta) ||
    a.dayGap - b.dayGap
  matches.sort(rank)
  nearMisses.sort(rank)
  return { matches, nearMisses }
}

// Signed day difference isoB - isoA (both 'YYYY-MM-DD'), calendar days.
function daysBetweenIso(isoA, isoB) {
  const a = Date.parse(`${isoA}T00:00:00Z`)
  const b = Date.parse(`${isoB}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return Math.round((b - a) / 86400000)
}

// -----------------------------------------------------------------------------
// itemKey(rawName): normalized key for receipt_item_rules — the receipt-item
// analogue of analysis.js merchantKey(). Drops the leading department/plu codes,
// weights, and punctuation that vary between visits, keeping the word stem so
// "365 ORG CHKN BRST 2" and "365 ORG CHKN BRST" collapse to one key.
// -----------------------------------------------------------------------------
export function itemKey(rawName) {
  if (!rawName) return ''
  return String(rawName)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ') // drop digits + punctuation (weights, PLU codes)
    .replace(/\s+/g, ' ')
    .trim()
}

// A human-friendlier query for the USDA food-search from a terse receipt line.
// Expands a few common grocery abbreviations and strips size/qty noise so
// "365 ORG CHKN BRST" searches as "org chkn brst" → "organic chicken breast".
const ABBREV = {
  org: 'organic',
  chkn: 'chicken',
  brst: 'breast',
  bnls: 'boneless',
  sknls: 'skinless',
  grnd: 'ground',
  bf: 'beef',
  chz: 'cheese',
  yog: 'yogurt',
  gr: 'greek',
  whp: 'whipping',
  crm: 'cream',
  ln: 'lean',
  bls: 'boneless',
  frz: 'frozen',
  veg: 'vegetable',
}

export function foodSearchQuery(rawName) {
  const words = itemKey(rawName).split(' ').filter(Boolean)
  const expanded = words.map((w) => ABBREV[w] ?? w)
  return expanded.join(' ').trim()
}

// -----------------------------------------------------------------------------
// perUnitCost(price, quantity): the cost to remember on the mapped food. When a
// weight/quantity is present ($8.99 for 1.2 lb) store the per-unit price
// ($7.49/lb); otherwise store the per-package price. Returns null when there's
// no usable price. Rounded to the cent.
// -----------------------------------------------------------------------------
export function perUnitCost(price, quantity) {
  const p = Number(price)
  if (!Number.isFinite(p) || p <= 0) return null
  const q = Number(quantity)
  if (Number.isFinite(q) && q > 0) return Math.round((p / q) * 100) / 100
  return Math.round(p * 100) / 100
}
