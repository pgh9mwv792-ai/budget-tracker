import { daysBetween, addDays } from './dateHelpers'

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

// Detects recurring transactions (subscriptions, regular income/bills) by
// grouping on merchantKey and looking for a roughly-regular cadence. Returns a
// list sorted by soonest next-expected date.
export function detectRecurring(transactions, { today = new Date().toISOString().slice(0, 10) } = {}) {
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

    let cadence = null
    if (avgGap >= 6 && avgGap <= 8) cadence = 'weekly'
    else if (avgGap >= 12 && avgGap <= 16) cadence = 'every 2 weeks'
    else if (avgGap >= 25 && avgGap <= 35) cadence = 'monthly'
    if (!cadence) continue

    const last = sorted[sorted.length - 1]
    const avgAmount = txs.reduce((acc, t) => acc + Number(t.amount), 0) / txs.length
    results.push({
      key,
      label: last.note || key,
      kind: last.kind,
      amount: avgAmount,
      cadence,
      count: txs.length,
      lastDate: last.date,
      nextDate: addDays(last.date, Math.round(avgGap)),
      overdue: addDays(last.date, Math.round(avgGap)) < today,
    })
  }

  return results.sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
}
