import { describe, it, expect } from 'vitest'
import { analyzeRecurring, recurringBurn, merchantKey } from './analysis'
import { addDays } from './dateHelpers'

const TODAY = '2026-07-06'

// Small helper to build a transaction. Amount and note are what detection keys
// off of; category name drives bill-vs-subscription classification.
function tx(note, amount, date, category = null, kind = 'expense') {
  return { id: `${note}-${date}`, note, amount, date, kind, category: category ? { name: category } : null }
}

// Monthly charges ending `monthsBack..0` months before an anchor date. Handy for
// building realistic recurring series without hand-writing every date.
function monthly(note, amount, count, { endOffsetDays = 0, category = null } = {}) {
  const rows = []
  for (let i = count - 1; i >= 0; i--) {
    rows.push(tx(note, amount, addDays(TODAY, -endOffsetDays - i * 30), category))
  }
  return rows
}

describe('analyzeRecurring — annual detection from 2 occurrences', () => {
  it('flags an annual charge with only two occurrences ~365 days apart', () => {
    const txns = [
      tx('Amazon Prime', 139, '2025-06-20'),
      tx('Amazon Prime', 139, '2026-06-20'),
    ]
    const groups = analyzeRecurring(txns, { today: TODAY })
    const prime = groups.find((g) => g.key === merchantKey('Amazon Prime'))
    expect(prime).toBeTruthy()
    expect(prime.cadence).toBe('annual')
    expect(prime.count).toBe(2)
    expect(prime.classification).toBe('subscription')
    expect(prime.amount).toBeCloseTo(139, 2)
  })

  it('does NOT flag a two-occurrence monthly charge (shorter cadences need 3+)', () => {
    const txns = [tx('Some App', 9.99, addDays(TODAY, -30)), tx('Some App', 9.99, addDays(TODAY, -60))]
    const groups = analyzeRecurring(txns, { today: TODAY })
    expect(groups.find((g) => g.key === merchantKey('Some App'))).toBeUndefined()
  })
})

describe('analyzeRecurring — price change flagging', () => {
  it('marks a streaming service that jumped beyond tolerance as price_changed', () => {
    // $15.99 → $15.99 → $19.99: +$4 / +25% clears max(15%, $3).
    const txns = [
      tx('Netflix', 15.99, addDays(TODAY, -62)),
      tx('Netflix', 15.99, addDays(TODAY, -31)),
      tx('Netflix', 19.99, addDays(TODAY, -1)),
    ]
    const groups = analyzeRecurring(txns, { today: TODAY })
    const netflix = groups.find((g) => g.key === merchantKey('Netflix'))
    expect(netflix).toBeTruthy()
    expect(netflix.status).toBe('price_changed')
    expect(netflix.priceDelta.direction).toBe('up')
    expect(netflix.priceDelta.from).toBeCloseTo(15.99, 2)
    expect(netflix.priceDelta.to).toBeCloseTo(19.99, 2)
    // Still a subscription: the prior amounts were tight.
    expect(netflix.classification).toBe('subscription')
  })

  it('does not flag a sub-tolerance drift as a price change', () => {
    const txns = [
      tx('Spotify', 11.99, addDays(TODAY, -62)),
      tx('Spotify', 11.99, addDays(TODAY, -31)),
      tx('Spotify', 12.99, addDays(TODAY, -1)), // +$1, within $3 floor
    ]
    const groups = analyzeRecurring(txns, { today: TODAY })
    const spotify = groups.find((g) => g.key === merchantKey('Spotify'))
    expect(spotify.status).toBe('active')
  })
})

describe('analyzeRecurring — missed / possibly cancelled', () => {
  it('marks a monthly membership that stopped charging as missed', () => {
    // Three monthly charges, the last on 2026-05-22. Next expected ~06-21;
    // missed threshold ~07-02, which is before today (07-06).
    const txns = [
      tx('Planet Fitness', 24.99, '2026-03-22'),
      tx('Planet Fitness', 24.99, '2026-04-22'),
      tx('Planet Fitness', 24.99, '2026-05-22'),
    ]
    const groups = analyzeRecurring(txns, { today: TODAY })
    const gym = groups.find((g) => g.key === merchantKey('Planet Fitness'))
    expect(gym).toBeTruthy()
    expect(gym.status).toBe('missed')
    expect(gym.missedSince).not.toBeNull()
    expect(gym.missedSince <= TODAY).toBe(true)
  })

  it('a currently-charging monthly subscription is active, not missed', () => {
    const groups = analyzeRecurring(monthly('Adobe', 9.99, 4), { today: TODAY })
    const adobe = groups.find((g) => g.key === merchantKey('Adobe'))
    expect(adobe.status).toBe('active')
  })
})

describe('analyzeRecurring — grocery false positive', () => {
  const groceries = [
    tx('Whole Foods', 82.4, addDays(TODAY, -22), 'Groceries'),
    tx('Whole Foods', 54.1, addDays(TODAY, -15), 'Groceries'),
    tx('Whole Foods', 118.75, addDays(TODAY, -8), 'Groceries'),
    tx('Whole Foods', 39.2, addDays(TODAY, -1), 'Groceries'),
  ]

  it('does not treat weekly-ish, wildly-varying grocery runs as recurring', () => {
    const groups = analyzeRecurring(groceries, { today: TODAY })
    expect(groups.find((g) => g.key === merchantKey('Whole Foods'))).toBeUndefined()
  })

  it('a not_recurring override keeps groceries out even once confirmed elsewhere', () => {
    const overrides = new Map([[merchantKey('Whole Foods'), { status: 'not_recurring' }]])
    const groups = analyzeRecurring(groceries, { today: TODAY, overrides })
    expect(groups.find((g) => g.key === merchantKey('Whole Foods'))).toBeUndefined()
  })

  it('a confirmed override surfaces groceries as a (variable) bill anyway', () => {
    const overrides = new Map([[merchantKey('Whole Foods'), { status: 'confirmed', nickname: 'Food budget' }]])
    const groups = analyzeRecurring(groceries, { today: TODAY, overrides })
    const g = groups.find((x) => x.key === merchantKey('Whole Foods'))
    expect(g).toBeTruthy()
    expect(g.label).toBe('Food budget')
  })
})

describe('analyzeRecurring — classification + burn', () => {
  const dataset = [
    ...monthly('Netflix', 15.99, 4),
    ...monthly('Rent', 1400, 4, { category: 'Housing & Rent' }),
    ...monthly('Electric', 65, 4, { category: 'Utilities' }),
    ...[
      tx('Amazon Prime', 139, '2025-06-20'),
      tx('Amazon Prime', 139, '2026-06-20'),
    ],
    // Salary income must never appear as a subscription/bill.
    ...monthly('Salary', 3200, 4).map((t) => ({ ...t, kind: 'income' })),
  ]

  it('splits subscriptions from bills and excludes income', () => {
    const groups = analyzeRecurring(dataset, { today: TODAY })
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]))
    expect(byKey[merchantKey('Netflix')].classification).toBe('subscription')
    expect(byKey[merchantKey('Amazon Prime')].classification).toBe('subscription')
    expect(byKey[merchantKey('Rent')].classification).toBe('bill')
    expect(byKey[merchantKey('Electric')].classification).toBe('bill')
    expect(byKey[merchantKey('Salary')]).toBeUndefined()
  })

  it('normalizes every cadence into a monthly burn', () => {
    const groups = analyzeRecurring(dataset, { today: TODAY })
    const { monthly: burn } = recurringBurn(groups)
    // 15.99 + 1400 + 65 + 139/12 ≈ 1492.57
    expect(burn).toBeCloseTo(15.99 + 1400 + 65 + 139 / 12, 1)
  })
})
