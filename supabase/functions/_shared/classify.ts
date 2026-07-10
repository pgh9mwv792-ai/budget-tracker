// ---------------------------------------------------------------------------
// classifyKind — pure income/expense/transfer classification for a Plaid
// transaction. Kept in its OWN Deno-free module (no Deno globals, no network,
// no jsr imports) so vitest can import and unit-test it directly. plaid.ts
// re-exports it, so callers keep importing from '../_shared/plaid.ts'.
//
// Why this matters: a "transfer" is money moving between two accounts the user
// OWNS (savings -> checking, or a credit-card PAYMENT from checking to the
// card). Those are not income or spending and must drop out of every
// income/expense total — otherwise a $500 card payment looks like $500 of new
// spending AND the card statement's incoming payment looks like $500 of income.
// A credit-card payment therefore has TWO legs (one on each account) and BOTH
// must classify as 'transfer'.
// ---------------------------------------------------------------------------

// Minimal shapes — Plaid sends much more, we only read these.
export interface PlaidTxnLike {
  amount: number
  name?: string | null
  category?: string[] | null
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null
}

export interface AccountLike {
  type?: string | null
  subtype?: string | null
}

// Descriptor phrases institutions print for a credit-card / loan payment. These
// are intentionally generic ("ONLINE PAYMENT" can be a third-party bill too),
// so on their own they never decide anything — they only trip a transfer when a
// counter-signal (below) confirms the money is moving between the user's own
// accounts. Matched case-insensitively against the transaction descriptor.
const CARD_PAYMENT_DESCRIPTORS: RegExp[] = [
  /\bE-?PAYMENT\b/, //          "DISCOVER E-PAYMENT", "EPAYMENT"
  /PAYMENT\s+THANK\s*YOU/, //   "PAYMENT THANK YOU - WEB" (Chase/Amex card side)
  /CARDMEMBER\s+PAY(?:MENT)?/, // "CARDMEMBER PAYMENT" (Amex)
  /\bONLINE\s+PAYMENT\b/, //     generic online bill/card payment
  /\bAUTOPAY\b/, //              "AUTOPAY PAYMENT"
  /\bBILL\s*PAY(?:MENT)?\b/, //  "BILL PAYMENT"
  /CREDIT\s+CARD\s+PAY(?:MENT)?/, // "CREDIT CARD PAYMENT"
]

function isCardPaymentDescriptor(name?: string | null): boolean {
  const text = String(name ?? '').toUpperCase()
  if (!text) return false
  return CARD_PAYMENT_DESCRIPTORS.some((re) => re.test(text))
}

// The counter-signal that a payment-like descriptor really is an internal
// transfer, not a bill to a third party. TRUE when either:
//   * Plaid tagged it a loan payment (personal_finance_category primary/detailed
//     starts with LOAN_PAYMENTS — the paying-checking leg often reports this), or
//   * the transaction sits on a credit-type account (the receiving card leg — a
//     "PAYMENT THANK YOU" landing on the Discover card itself).
// A plain checking-account bill payment to the electric company matches neither,
// so it correctly stays an expense.
function hasCardPaymentCounterSignal(t: PlaidTxnLike, account?: AccountLike | null): boolean {
  const pfc = t.personal_finance_category ?? {}
  if (typeof pfc.primary === 'string' && pfc.primary.startsWith('LOAN_PAYMENTS')) return true
  if (typeof pfc.detailed === 'string' && pfc.detailed.startsWith('LOAN_PAYMENTS')) return true
  if (account) {
    if (account.type === 'credit') return true
    if (typeof account.subtype === 'string' && /credit\s*card|paypal\s*credit/i.test(account.subtype)) {
      return true
    }
  }
  return false
}

// Classifies one Plaid transaction. `account` is the plaid_accounts row the
// transaction belongs to (type/subtype), used only for the descriptor-fallback
// counter-signal; omit it and classification still works from Plaid's own
// category fields.
export function classifyKind(
  t: PlaidTxnLike,
  account?: AccountLike | null,
): 'income' | 'expense' | 'transfer' {
  const pfc = t.personal_finance_category ?? {}
  const primary = pfc.primary
  const detailed = pfc.detailed

  // Explicit, unambiguous signals first. A credit-card payment is the canonical
  // internal transfer; Plaid marks it on BOTH legs (paying + receiving) as
  // detailed LOAN_PAYMENTS_CREDIT_CARD_PAYMENT and/or primary TRANSFER_IN/OUT.
  if (detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return 'transfer'
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT') return 'transfer'

  // Legacy category array fallback (older Plaid items report this instead).
  const legacy = Array.isArray(t.category) ? t.category : []
  if (legacy.some((c) => /transfer/i.test(c))) return 'transfer'

  // Descriptor fallback for institutions that report generically (no useful
  // personal_finance_category). Only trips when a payment-like descriptor is
  // corroborated by a counter-signal, so ordinary bill payments to third parties
  // aren't swept in.
  if (isCardPaymentDescriptor(t.name) && hasCardPaymentCounterSignal(t, account)) {
    return 'transfer'
  }

  // Plaid convention: positive amount = money out (expense),
  // negative amount = money in (income/credit).
  return t.amount >= 0 ? 'expense' : 'income'
}
