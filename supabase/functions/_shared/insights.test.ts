import { describe, it, expect } from 'vitest'
import { composeDigest, analyzeRecurring } from './insights.ts'

const TODAY = '2026-07-06' // weekStart = 2026-06-30

function tx(note: string, amount: number, date: string, category: string | null = null, kind = 'expense') {
  return { note, amount, date, kind, category: category ? { name: category } : null }
}

// A realistic recurring set: a streaming service whose price jumped this week, a
// gym membership that stopped charging, and a brand-new subscription whose third
// charge lands this week (so it first qualifies now).
const RECURRING = [
  tx('Netflix', 15.99, '2026-04-05'),
  tx('Netflix', 15.99, '2026-05-05'),
  tx('Netflix', 15.99, '2026-06-04'),
  tx('Netflix', 19.99, '2026-07-04'), // price hike, within this week
  tx('Planet Fitness', 24.99, '2026-03-22'),
  tx('Planet Fitness', 24.99, '2026-04-22'),
  tx('Planet Fitness', 24.99, '2026-05-22'), // then silence → missed this cycle
  tx('Spotify', 9.99, '2026-05-02'),
  tx('Spotify', 9.99, '2026-06-01'),
  tx('Spotify', 9.99, '2026-07-01'), // third charge tips it into "recurring" this week
]

describe('composeDigest — subscription change sections', () => {
  const { sections } = composeDigest({ transactions: RECURRING }, { today: TODAY })
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))

  it('includes a price-change line with the old and new amounts', () => {
    expect(byKey.price_change).toBeTruthy()
    expect(byKey.price_change.body).toContain('15.99')
    expect(byKey.price_change.body).toContain('19.99')
  })

  it('includes a missed/possibly-cancelled line for the lapsed gym', () => {
    expect(byKey.missed).toBeTruthy()
    expect(byKey.missed.body).toContain('Planet Fitness')
  })

  it('includes a new-recurring line for the freshly-qualifying subscription', () => {
    expect(byKey.new_recurring).toBeTruthy()
    expect(byKey.new_recurring.body).toContain('Spotify')
  })

  it('respects a not_recurring override across every section', () => {
    const overrides = [{ merchant_key: 'planet fitness', status: 'not_recurring' as const }]
    const { sections: s2 } = composeDigest(
      { transactions: RECURRING, recurringOverrides: overrides },
      { today: TODAY },
    )
    expect(s2.find((s) => s.key === 'missed')).toBeUndefined()
  })
})

describe('analyzeRecurring (shared port) matches the frontend contract', () => {
  it('classifies and normalizes a monthly subscription', () => {
    const groups = analyzeRecurring(RECURRING, { today: TODAY })
    const netflix = groups.find((g) => g.key === 'netflix')
    expect(netflix?.classification).toBe('subscription')
    expect(netflix?.status).toBe('price_changed')
    expect(netflix?.monthlyEquivalent).toBeCloseTo(netflix!.amount, 5)
  })
})
