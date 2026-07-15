import { describe, it, expect } from 'vitest'
import { cleanMerchantName } from './merchantName'

describe('cleanMerchantName', () => {
  it('maps well-known brands to their canonical name', () => {
    expect(cleanMerchantName('RECURRING PAYMENT AUTHORIZED ON 06/19 NYTIMES DISC* NY S466170595160152 CARD 5346')).toBe('NY Times')
    expect(cleanMerchantName('NETFLIX.COM 866-579-7172 CA')).toBe('Netflix')
    expect(cleanMerchantName('PURCHASE AUTHORIZED ON 04/26 WHOLEFDS MKT 123 DENVER CO')).toBe('Whole Foods')
    expect(cleanMerchantName('AUTOZONE #4412 WHEAT RIDGE CO')).toBe('AutoZone')
  })

  it('strips the bank prefix, date, and trailing ref/card/state for unknown merchants', () => {
    expect(cleanMerchantName('PURCHASE AUTHORIZED ON 05/02 HO MEI CHINESE RES WHEAT RIDGE CO S466 CARD 5346')).toBe('Ho Mei Chinese')
    expect(cleanMerchantName('POS DEBIT 07/01 CORNER BODEGA NY 8842')).toBe('Corner Bodega')
  })

  it('falls back gracefully on empty or unreadable input', () => {
    expect(cleanMerchantName('')).toBe('Transaction')
    expect(cleanMerchantName(null)).toBe('Transaction')
    expect(cleanMerchantName('   ', 'Uncategorized')).toBe('Uncategorized')
  })

  it('leaves already-clean names looking right', () => {
    expect(cleanMerchantName('Chipotle')).toBe('Chipotle')
    expect(cleanMerchantName('Blue Bottle Coffee')).toBe('Blue Bottle Coffee')
  })
})
