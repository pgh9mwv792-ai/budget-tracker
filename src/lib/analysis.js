import { daysBetween, addDays, todayISO } from './dateHelpers'

// Normalizes a transaction note/merchant into a stable key so that variations
// of the same merchant collapse together. e.g.
//   "Uber 072515 SF**POOL**"  -> "uber sfpool"
//   "Starbucks"               -> "starbucks"
//   "CREDIT CARD 3333 PAYMENT *//" -> "credit card payment"
// Digits and punctuation are stripped; whitespace collapsed; lowercased.
export function merchantKey(note) {
  if (!note) return ''
  return note
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ') // drop digits + punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

// Given all transactions and the saved merchant rules, returns the uncategorized
// transactions that have a matching rule, paired with the category to apply.
// rulesByKey: Map(merchant_key -> category_id)
export function matchRules(transactions, rulesByKey) {
  const matches = []
  for (const t of transactions) {
    if (t.category_id) continue
    // Never auto-categorize a transfer — assigning a category would flip its
    // kind back to income/expense and re-pollute the totals.
    if (t.kind === 'transfer') continue
    const key = merchantKey(t.note)
    if (!key) continue
    const categoryId = rulesByKey.get(key)
    if (categoryId) matches.push({ id: t.id, categoryId })
  }
  return matches
}

// ---------------------------------------------------------------------------
// Cadence bands, shared by the legacy detectRecurring (dashboard/forecast) and
// the richer analyzeRecurring (Subscriptions view + digest). `perMonth` is the
// number of charges per month at that cadence — used to normalize everything to
// a monthly-equivalent burn. `grace` is the slack (in days) around the expected
// date; a charge is "missed" once the next expected date passes by > 1.5×grace.
// ---------------------------------------------------------------------------
const CADENCE_BANDS = [
  { name: 'weekly', min: 5, max: 9, perMonth: 30.4 / 7, grace: 3 },
  { name: 'every 2 weeks', min: 11, max: 18, perMonth: 30.4 / 14, grace: 4 },
  { name: 'monthly', min: 24, max: 38, perMonth: 1, grace: 7 },
  { name: 'quarterly', min: 80, max: 100, perMonth: 1 / 3, grace: 12 },
  { name: 'annual', min: 350, max: 380, perMonth: 1 / 12, grace: 20 },
]

function bandFor(gap) {
  return CADENCE_BANDS.find((b) => gap >= b.min && gap <= b.max) ?? null
}

function median(nums) {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function isoToday() {
  return todayISO()
}

// Detects recurring transactions (subscriptions, regular income/bills) by
// grouping on merchantKey and looking for a roughly-regular cadence. Returns a
// list sorted by soonest next-expected date. This is the lightweight view the
// dashboard "Recurring & upcoming" card and the month-outlook forecast use, so
// it keeps its long-standing shape and includes income/transfers.
export function detectRecurring(transactions, { today = isoToday() } = {}) {
  const groups = new Map()
  for (const t of transactions) {
    const key = merchantKey(t.note)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  const results = []
  for (const [key, txs] of groups) {
    if (txs.length < 2) continue // need at least two occurrences to see a pattern

    const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))
    const gaps = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date))
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length

    const band = bandFor(avgGap)
    if (!band) continue
    const cadence = band.name

    const last = sorted[sorted.length - 1]
    const avgAmount = txs.reduce((acc, t) => acc + Number(t.amount), 0) / txs.length
    const nextDate = addDays(last.date, Math.round(avgGap))
    results.push({
      key,
      label: last.note || key,
      kind: last.kind,
      amount: avgAmount,
      cadence,
      count: txs.length,
      lastDate: last.date,
      nextDate,
      overdue: nextDate < today,
    })
  }

  return results.sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
}

// Merchant/category text that marks a group as a "bill" (utilities, insurance,
// rent-like) rather than a discretionary subscription. Bills legitimately vary
// in amount, so they're classified by category instead of amount-consistency.
const BILL_RE =
  /utilit|electric|energy|\bgas\b|\bwater\b|sewer|insurance|\brent\b|mortgage|internet|broadband|cable|wireless|\bphone\b|verizon|comcast|xfinity|spectrum/i

// ---------------------------------------------------------------------------
// analyzeRecurring — the hardened detector behind the Subscriptions view and
// the weekly digest. Pure and deterministic (pass `today`). Unlike
// detectRecurring it:
//   * excludes transfers AND income (income keeps its own detection path),
//   * adds quarterly + annual cadences (annual qualifies from just 2 charges;
//     shorter cadences need 3+ to cut noise),
//   * tracks the full amount series and classifies each group as a
//     'subscription' (tight, discretionary) or a 'bill' (bill-like category or
//     naturally-variable amount),
//   * computes status: 'active' | 'price_changed' | 'missed',
//   * honors per-merchant user overrides: 'not_recurring' groups are dropped
//     entirely; 'confirmed' groups always surface even when marginal; a
//     nickname replaces the raw merchant label.
//
// `overrides` is a Map(merchant_key -> { status, nickname }).
// ---------------------------------------------------------------------------
export function analyzeRecurring(transactions, { today = isoToday(), overrides = new Map() } = {}) {
  const groups = new Map()
  for (const t of transactions) {
    if (t.kind === 'transfer' || t.kind === 'income') continue
    const key = merchantKey(t.note)
    if (!key) continue
    if (overrides.get(key)?.status === 'not_recurring') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  const results = []
  for (const [key, txs] of groups) {
    const ov = overrides.get(key)
    const group = buildRecurringGroup(key, txs, {
      today,
      confirmed: ov?.status === 'confirmed',
      nickname: ov?.nickname || null,
    })
    if (group) results.push(group)
  }

  return results.sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
}

function buildRecurringGroup(key, txs, { today, confirmed, nickname }) {
  if (txs.length < 2) return null

  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))
  const gaps = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date))
  }
  const medGap = median(gaps)
  const band = bandFor(medGap)

  // Occurrence bar: annual needs only 2 (a year apart is rare data); every
  // shorter cadence needs 3+ so a couple of coincidental repeats don't qualify.
  const minOcc = band?.name === 'annual' ? 2 : 3
  const meetsCadence = !!band && sorted.length >= minOcc
  if (!meetsCadence && !confirmed) return null

  const amounts = sorted.map((t) => Number(t.amount))
  const med = median(amounts)
  const last = sorted[sorted.length - 1]

  // Classification. A bill-like category is a bill regardless of variance;
  // otherwise, tight amounts (ignoring the latest, which may be a price change)
  // make a subscription, and anything else is too noisy to be a real recurring
  // charge (this is what keeps weekly-ish grocery runs out of the list).
  const catName = last.category?.name ?? ''
  const noteText = sorted.map((t) => t.note ?? '').join(' ')
  const billish = BILL_RE.test(catName) || BILL_RE.test(noteText)

  const prior = amounts.slice(0, -1)
  const priorMed = median(prior)
  const priorTol = Math.max(0.15 * priorMed, 3)
  const priorConsistent = prior.length === 0 || prior.every((a) => Math.abs(a - priorMed) <= priorTol)

  let classification
  if (billish) classification = 'bill'
  else if (priorConsistent) classification = 'subscription'
  else if (confirmed) classification = 'bill' // user insists; treat variable spend as a bill
  else return null

  // Next expected date from the typical gap.
  const nextDate = addDays(last.date, Math.round(medGap || 30))

  // Status. A latest amount outside tolerance of the prior median is a price
  // change; a next-expected date that has slipped well past its grace window
  // (and hasn't been charged) is a missed/possibly-cancelled charge — that
  // takes precedence since it's about absence of a charge.
  const latest = amounts[amounts.length - 1]
  let status = 'active'
  let priceDelta = null
  if (prior.length >= 1 && Math.abs(latest - priorMed) > priorTol) {
    status = 'price_changed'
    priceDelta = { from: priorMed, to: latest, direction: latest > priorMed ? 'up' : 'down' }
  }

  const grace = band?.grace ?? 7
  const missThreshold = addDays(nextDate, Math.round(1.5 * grace))
  let missedSince = null
  if (missThreshold < today) {
    status = 'missed'
    missedSince = missThreshold
  }

  const perMonth = band?.perMonth ?? 1
  return {
    key,
    label: nickname || last.note || key,
    rawLabel: last.note || key,
    nickname: nickname || null,
    classification,
    cadence: band?.name ?? 'irregular',
    amount: med,
    monthlyEquivalent: med * perMonth,
    count: sorted.length,
    lastDate: last.date,
    nextDate,
    history: sorted.map((t) => ({ date: t.date, amount: Number(t.amount) })),
    lifetime: amounts.reduce((a, b) => a + b, 0),
    status,
    priceDelta,
    missedSince,
    confirmed: !!confirmed,
  }
}

// Rolls an analyzeRecurring() result up into the numbers the Subscriptions
// summary strip and headline need: total monthly burn (all cadences normalized
// to a monthly equivalent) and the annualized figure. Missed/possibly-cancelled
// charges are excluded from the burn — you're likely not paying them anymore.
export function recurringBurn(groups) {
  const active = groups.filter((g) => g.status !== 'missed')
  const monthly = active.reduce((acc, g) => acc + g.monthlyEquivalent, 0)
  return { monthly, annual: monthly * 12, count: active.length }
}
