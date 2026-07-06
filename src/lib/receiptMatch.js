// ---------------------------------------------------------------------------
// Pure, Supabase-free matching + normalization helpers for receipt itemization.
// Kept deliberately dependency-light (only date math) so they are unit-testable
// and identical in the browser and in a test runner. No I/O, no React.
// ---------------------------------------------------------------------------

// Plaid posts a purchase a few days after the swipe (pending → posted), so a
// receipt dated the 3rd can match a transaction dated the 3rd–7th.
const POST_LAG_DAYS = 4
// A "near miss" is allowed to be off by a cent (tip/rounding) or land exactly on
// the far date boundary — surfaced separately as low-confidence, never auto-used.
const NEAR_CENTS = 2

// Normalizes a store/merchant string for comparison: uppercase, strip anything
// that isn't a letter or digit, collapse to a single token stream. This makes
// "WHOLEFDS #10234" and "Whole Foods Market" comparable without a fuzzy-match
// dependency. Returns { compact, tokens } — compact for substring tests, tokens
// for overlap scoring.
export function normalizeMerchant(s) {
  const upper = String(s ?? '').toUpperCase()
  const compact = upper.replace(/[^A-Z0-9]/g, '')
  const tokens = upper
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length >= 2) // drop 1-char noise ("#", stray letters)
  return { compact, tokens }
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

// The text on a transaction we compare a store name against.
function txnMerchantText(t) {
  return t?.merchant_name || t?.note || t?.name || ''
}

// Cents-safe equality: numeric(12,2) money compared as integer cents.
function toCents(n) {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
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
//   { transaction, similarity, dayGap, confidence, reason }.
// `matches` are exact-amount, in-window candidates (best first). `nearMisses`
// are off-by-a-cent or on the date boundary, shown separately as low-confidence.
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

  const matches = []
  const nearMisses = []

  for (const t of transactions) {
    if (!t || excluded.has(String(t.id))) continue
    // Only Plaid expenses are candidates — the receipt annotates real bank money.
    if (t.source !== 'plaid' || t.kind !== 'expense') continue

    const centsDiff = Math.abs(toCents(t.amount) - wantCents)
    // dayGap: how many days AFTER the purchase the transaction posted (negative
    // when the transaction predates the receipt, which disqualifies it).
    const dayGap = daysBetweenIso(date, t.date)
    const similarity = merchantSimilarity(receipt?.store_name, txnMerchantText(t))

    const inWindow = dayGap >= 0 && dayGap <= POST_LAG_DAYS

    if (centsDiff === 0 && inWindow) {
      matches.push({ transaction: t, similarity, dayGap, confidence: 'high', reason: 'exact amount, in window' })
    } else if (centsDiff <= NEAR_CENTS && dayGap >= 0 && dayGap <= POST_LAG_DAYS + 1) {
      // Off by a cent (tip/rounding) OR exact amount but one day past the window.
      const reason = centsDiff === 0 ? 'exact amount, boundary date' : `within ${NEAR_CENTS}¢`
      nearMisses.push({ transaction: t, similarity, dayGap, confidence: 'low', reason })
    }
  }

  // Best match first: higher merchant similarity, then the smaller posting lag.
  const rank = (a, b) => b.similarity - a.similarity || a.dayGap - b.dayGap
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
