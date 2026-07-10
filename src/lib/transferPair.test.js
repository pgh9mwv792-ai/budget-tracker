import { describe, it, expect } from 'vitest'
import { pairTransfers } from './transferPair'

// A transfer leg with sensible defaults; override per case.
let seq = 0
function leg(over = {}) {
  return {
    id: `t${seq++}`,
    kind: 'transfer',
    amount: 250,
    date: '2026-07-01',
    account_id: 'acct_checking',
    note: 'TRANSFER',
    ...over,
  }
}

describe('pairTransfers — auto pairs', () => {
  it('auto-pairs two transfer legs: exact amount, different accounts, within the window', () => {
    const a = leg({ id: 'a', account_id: 'checking', date: '2026-07-01' })
    const b = leg({ id: 'b', account_id: 'card', date: '2026-07-03' })
    const { autoPairs, suspectedPairs } = pairTransfers([a, b])
    expect(autoPairs).toHaveLength(1)
    expect(suspectedPairs).toHaveLength(0)
    expect(new Set([autoPairs[0].a.id, autoPairs[0].b.id])).toEqual(new Set(['a', 'b']))
    expect(autoPairs[0].status).toBe('auto')
  })

  it('compares on the authorized date, not the posted date (reuses receiptMatch extraction)', () => {
    // The two legs post 3 days apart, but both carry the same AUTHORIZED date, so
    // their effective gap is 0 → a confident auto-pair.
    const a = leg({ id: 'a', account_id: 'checking', date: '2026-07-04', note: 'DISCOVER E-PAYMENT AUTHORIZED ON 07/01' })
    const b = leg({ id: 'b', account_id: 'card', date: '2026-07-01', note: 'PAYMENT THANK YOU AUTHORIZED ON 07/01' })
    const { autoPairs } = pairTransfers([a, b])
    expect(autoPairs).toHaveLength(1)
    expect(autoPairs[0].gapDays).toBe(0)
  })
})

describe('pairTransfers — suspected pairs (never auto-linked)', () => {
  it('flags an exact amount whose dates sit on the window boundary as suspected', () => {
    const a = leg({ id: 'a', account_id: 'checking', date: '2026-07-01' })
    const b = leg({ id: 'b', account_id: 'card', date: '2026-07-05' }) // gap = 4 (boundary)
    const { autoPairs, suspectedPairs } = pairTransfers([a, b])
    expect(autoPairs).toHaveLength(0)
    expect(suspectedPairs).toHaveLength(1)
    expect(suspectedPairs[0].gapDays).toBe(4)
  })

  it('flags amounts within 2¢ as suspected, not auto', () => {
    const a = leg({ id: 'a', account_id: 'checking', amount: 250.0, date: '2026-07-01' })
    const b = leg({ id: 'b', account_id: 'card', amount: 250.02, date: '2026-07-02' })
    const { autoPairs, suspectedPairs } = pairTransfers([a, b])
    expect(autoPairs).toHaveLength(0)
    expect(suspectedPairs).toHaveLength(1)
    expect(suspectedPairs[0].amountDeltaCents).toBe(2)
  })
})

describe('pairTransfers — exclusions', () => {
  it('excludes dates beyond the window', () => {
    const a = leg({ id: 'a', account_id: 'checking', date: '2026-07-01' })
    const b = leg({ id: 'b', account_id: 'card', date: '2026-07-06' }) // gap = 5
    const { autoPairs, suspectedPairs } = pairTransfers([a, b])
    expect(autoPairs).toHaveLength(0)
    expect(suspectedPairs).toHaveLength(0)
  })

  it('excludes legs on the same account', () => {
    const a = leg({ id: 'a', account_id: 'checking', date: '2026-07-01' })
    const b = leg({ id: 'b', account_id: 'checking', date: '2026-07-02' })
    expect(pairTransfers([a, b]).autoPairs).toHaveLength(0)
  })

  it('excludes amounts that differ by more than 2¢', () => {
    const a = leg({ id: 'a', account_id: 'checking', amount: 250.0 })
    const b = leg({ id: 'b', account_id: 'card', amount: 250.05 })
    const { autoPairs, suspectedPairs } = pairTransfers([a, b])
    expect(autoPairs).toHaveLength(0)
    expect(suspectedPairs).toHaveLength(0)
  })

  it('excludes non-transfer transactions entirely', () => {
    const a = leg({ id: 'a', account_id: 'checking', kind: 'expense' })
    const b = leg({ id: 'b', account_id: 'card', kind: 'income' })
    expect(pairTransfers([a, b]).autoPairs).toHaveLength(0)
  })

  it('excludes legs already in a saved pair', () => {
    const a = leg({ id: 'a', account_id: 'checking' })
    const b = leg({ id: 'b', account_id: 'card' })
    expect(pairTransfers([a, b], { alreadyPairedIds: ['a'] }).autoPairs).toHaveLength(0)
  })

  it('respects an optional direction signal: two same-direction legs are not a pair', () => {
    const a = leg({ id: 'a', account_id: 'checking' })
    const b = leg({ id: 'b', account_id: 'savings' })
    const signOf = () => 1 // both "out" → same direction
    expect(pairTransfers([a, b], { signOf }).autoPairs).toHaveLength(0)
  })
})

describe('pairTransfers — greedy assignment', () => {
  it('uses each leg in at most one pair, preferring the closest match', () => {
    // a exactly matches b (gap 1); c also matches a on amount but further out.
    const a = leg({ id: 'a', account_id: 'checking', date: '2026-07-02' })
    const b = leg({ id: 'b', account_id: 'card', date: '2026-07-01' })
    const c = leg({ id: 'c', account_id: 'savings', date: '2026-07-05' })
    const { autoPairs, suspectedPairs } = pairTransfers([a, b, c])
    const allPaired = [...autoPairs, ...suspectedPairs].flatMap((p) => [p.a.id, p.b.id])
    // a is consumed by its best match; no id appears twice.
    expect(new Set(allPaired).size).toBe(allPaired.length)
    expect(autoPairs[0] && new Set([autoPairs[0].a.id, autoPairs[0].b.id])).toEqual(new Set(['a', 'b']))
  })
})
