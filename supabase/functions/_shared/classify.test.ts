import { describe, it, expect } from 'vitest'
import { classifyKind } from './classify.ts'

// A Plaid transaction with sensible defaults; override per case. Plaid's sign
// convention: positive amount = money OUT (expense), negative = money IN.
function txn(over: Record<string, unknown> = {}) {
  return { amount: 25, name: 'SOME MERCHANT', ...over }
}

const pfc = (primary: string, detailed?: string) => ({
  personal_finance_category: { primary, detailed: detailed ?? null },
})

describe('classifyKind — plain income/expense', () => {
  it('treats a positive amount as an expense', () => {
    expect(classifyKind(txn({ amount: 42.5 }))).toBe('expense')
  })

  it('treats a negative amount as income', () => {
    expect(classifyKind(txn({ amount: -1200, name: 'ACME PAYROLL' }))).toBe('income')
  })

  it('does not mistake a third-party online bill payment for a transfer', () => {
    // "ONLINE PAYMENT" descriptor but NO counter-signal (regular checking
    // account, no loan category) → stays an expense.
    expect(classifyKind(txn({ amount: 90, name: 'CITY ELECTRIC ONLINE PAYMENT' }))).toBe('expense')
  })
})

describe('classifyKind — transfers from Plaid category fields', () => {
  it('classifies TRANSFER_OUT as a transfer', () => {
    expect(classifyKind(txn({ amount: 500, ...pfc('TRANSFER_OUT') }))).toBe('transfer')
  })

  it('classifies TRANSFER_IN as a transfer', () => {
    expect(classifyKind(txn({ amount: -500, ...pfc('TRANSFER_IN') }))).toBe('transfer')
  })

  it('classifies the detailed LOAN_PAYMENTS_CREDIT_CARD_PAYMENT on both legs', () => {
    // Paying leg (money out of checking).
    expect(
      classifyKind(txn({ amount: 300, ...pfc('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') })),
    ).toBe('transfer')
    // Receiving leg (payment landing on the card, money in).
    expect(
      classifyKind(txn({ amount: -300, ...pfc('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') })),
    ).toBe('transfer')
  })

  it('still honors the legacy category array', () => {
    expect(classifyKind(txn({ amount: 200, category: ['Transfer', 'Debit'] }))).toBe('transfer')
  })
})

describe('classifyKind — descriptor fallback for generically-reported institutions', () => {
  it('classifies the real-world "DISCOVER E-PAYMENT" checking leg with a loan counter-signal', () => {
    // Descriptor is generic (no TRANSFER_* / no detailed card-payment code), but
    // Plaid still marks primary LOAN_PAYMENTS → the counter-signal trips it.
    expect(
      classifyKind(txn({ amount: 250, name: 'DISCOVER E-PAYMENT', ...pfc('LOAN_PAYMENTS') })),
    ).toBe('transfer')
  })

  it('classifies a "PAYMENT THANK YOU" landing on the credit-card account', () => {
    // No useful personal_finance_category at all — the counter-signal is that
    // the transaction sits on a credit-type account (the card's receiving leg).
    expect(
      classifyKind(txn({ amount: -250, name: 'ONLINE PAYMENT - THANK YOU' }), { type: 'credit', subtype: 'credit card' }),
    ).toBe('transfer')
  })

  it('classifies "CARDMEMBER PAYMENT" on a credit account', () => {
    expect(
      classifyKind(txn({ amount: -80, name: 'AMEX EPAYMENT CARDMEMBER PAYMENT' }), { type: 'credit', subtype: 'credit card' }),
    ).toBe('transfer')
  })

  it('does NOT trip on a payment descriptor without any counter-signal', () => {
    // "DISCOVER E-PAYMENT" text but on a plain checking account and no loan
    // category → we can't prove it's internal, so leave it an expense rather
    // than risk sweeping in a genuine third-party payment.
    expect(
      classifyKind(txn({ amount: 250, name: 'DISCOVER E-PAYMENT' }), { type: 'depository', subtype: 'checking' }),
    ).toBe('expense')
  })

  it('does NOT trip on a non-payment charge that happens to be on a credit card', () => {
    // A normal purchase on the credit card: descriptor isn't payment-like, so the
    // credit-account counter-signal alone must not turn it into a transfer.
    expect(
      classifyKind(txn({ amount: 63.2, name: 'WHOLEFDS #123 PURCHASE' }), { type: 'credit', subtype: 'credit card' }),
    ).toBe('expense')
  })
})
