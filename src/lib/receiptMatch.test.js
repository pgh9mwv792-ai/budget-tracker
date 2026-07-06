import { describe, it, expect } from 'vitest'
import {
  rankTransactionMatches,
  descriptorPurchaseDate,
  normalizeMerchant,
  merchantSimilarity,
} from './receiptMatch'

// Build a Plaid expense transaction with sensible defaults; override per case.
function txn(over = {}) {
  return { id: 't', source: 'plaid', kind: 'expense', amount: 50, date: '2026-06-29', ...over }
}

describe('descriptorPurchaseDate', () => {
  it('reads "AUTHORIZED ON MM/DD" and infers the year from the posted date', () => {
    expect(descriptorPurchaseDate('WHOLEFDS #10234 AUTHORIZED ON 06/28', '2026-07-05')).toBe('2026-06-28')
  })

  it('rolls back a year at the Dec-purchase / Jan-post boundary', () => {
    // Purchased 12/28, posted 01/02 of the next year → authorized date is last year.
    expect(descriptorPurchaseDate('AUTHORIZED ON 12/28', '2026-01-02')).toBe('2025-12-28')
  })

  it('honors an explicit 2-digit year in "ON MM/DD/YY"', () => {
    expect(descriptorPurchaseDate('POS DEBIT ON 06/28/25', '2026-07-01')).toBe('2025-06-28')
  })

  it('returns null when there is no authorized date', () => {
    expect(descriptorPurchaseDate('TRADER JOES #88 PURCHASE', '2026-06-30')).toBeNull()
  })
})

describe('normalizeMerchant', () => {
  it('drops store numbers, state codes, and generic descriptor words', () => {
    expect(normalizeMerchant('WHOLEFDS #10234 CA PURCHASE').tokens).toEqual(['WHOLEFDS'])
  })
})

describe('merchantSimilarity', () => {
  it('matches an abbreviated bank descriptor to the store name', () => {
    expect(merchantSimilarity('Whole Foods', 'WHOLEFDS #10234')).toBeGreaterThanOrEqual(0.5)
  })

  it('scores an unrelated merchant at zero', () => {
    expect(merchantSimilarity('Whole Foods', 'SHELL OIL 4432')).toBe(0)
  })
})

describe('rankTransactionMatches', () => {
  const receipt = { total: 84.32, purchase_date: '2026-06-28', store_name: 'Whole Foods' }

  it('uses the authorized date so a late-posting charge still matches (high)', () => {
    // Posted 7 days later — outside the posting window — but the descriptor says
    // it was authorized on the receipt's date, which is the true purchase date.
    const t = txn({
      id: 'auth',
      amount: 84.32,
      date: '2026-07-05',
      note: 'WHOLEFDS #10234 AUTHORIZED ON 06/28',
    })
    const { matches, nearMisses } = rankTransactionMatches(receipt, [t])
    expect(matches).toHaveLength(1)
    expect(matches[0].confidence).toBe('high')
    expect(matches[0].dateSource).toBe('authorized')
    expect(nearMisses).toHaveLength(0)
  })

  it('without the authorized date, the same late-posting charge is not a match', () => {
    const t = txn({ id: 'nolag', amount: 84.32, date: '2026-07-05', note: 'WHOLEFDS #10234' })
    const { matches, nearMisses } = rankTransactionMatches(receipt, [t])
    expect(matches).toHaveLength(0)
    expect(nearMisses).toHaveLength(0)
  })

  it('surfaces a coupon-lower and a tax-higher charge both at medium confidence', () => {
    const r = { total: 50.0, purchase_date: '2026-06-28', store_name: 'Trader Joes' }
    const coupon = txn({ id: 'coupon', amount: 46.5, date: '2026-06-30', merchant_name: 'TRADER JOES #88' })
    const tax = txn({ id: 'tax', amount: 53.2, date: '2026-06-29', merchant_name: 'TRADER JOES #88' })
    const { matches, nearMisses } = rankTransactionMatches(r, [coupon, tax])
    expect(matches).toHaveLength(0)
    expect(nearMisses).toHaveLength(2)
    expect(nearMisses.every((m) => m.confidence === 'medium')).toBe(true)
    const byId = Object.fromEntries(nearMisses.map((m) => [m.transaction.id, m]))
    expect(byId.coupon.amountDelta).toBeLessThan(0) // charged less
    expect(byId.tax.amountDelta).toBeGreaterThan(0) // charged more
  })

  it('excludes a same-amount charge from a different merchant, keeping the right one', () => {
    const r = { total: 50.0, purchase_date: '2026-06-28', store_name: 'Whole Foods' }
    const wrong = txn({ id: 'shell', amount: 50.0, date: '2026-06-29', merchant_name: 'SHELL OIL 4432' })
    const right = txn({ id: 'wf', amount: 50.0, date: '2026-06-29', merchant_name: 'WHOLEFDS #10234' })
    const { matches, nearMisses } = rankTransactionMatches(r, [wrong, right])
    expect(matches).toHaveLength(1)
    expect(matches[0].transaction.id).toBe('wf')
    expect(nearMisses).toHaveLength(0)
  })

  it('returns empty (no best-guess) when nothing lines up', () => {
    const r = { total: 50.0, purchase_date: '2026-06-28', store_name: 'Whole Foods' }
    const outOfTolerance = txn({ id: 'big', amount: 200.0, date: '2026-06-29', merchant_name: 'WHOLE FOODS' })
    const notPlaid = txn({ id: 'manual', source: 'manual', amount: 50.0, merchant_name: 'WHOLE FOODS' })
    const income = txn({ id: 'inc', kind: 'income', amount: 50.0, merchant_name: 'WHOLE FOODS' })
    const { matches, nearMisses } = rankTransactionMatches(r, [outOfTolerance, notPlaid, income])
    expect(matches).toHaveLength(0)
    expect(nearMisses).toHaveLength(0)
  })

  it('skips a transaction already claimed by another receipt', () => {
    const r = { total: 50.0, purchase_date: '2026-06-28', store_name: 'Whole Foods' }
    const t = txn({ id: 'claimed', amount: 50.0, date: '2026-06-29', merchant_name: 'WHOLEFDS #10234' })
    const { matches, nearMisses } = rankTransactionMatches(r, [t], { alreadyMatchedIds: ['claimed'] })
    expect(matches).toHaveLength(0)
    expect(nearMisses).toHaveLength(0)
  })
})
