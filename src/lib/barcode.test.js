import { describe, it, expect } from 'vitest'
import { normalizeUpc, upcKey, findFoodByUpc, plausibleMacros } from './barcode'

describe('normalizeUpc', () => {
  it('keeps digits and preserves leading zeros', () => {
    expect(normalizeUpc('0016000275287')).toBe('0016000275287')
    expect(normalizeUpc('016000275287')).toBe('016000275287')
  })
  it('strips separators', () => {
    expect(normalizeUpc('0 16000 27528 7')).toBe('016000275287')
  })
  it('rejects non-barcode lengths', () => {
    expect(normalizeUpc('123')).toBeNull()
    expect(normalizeUpc('')).toBeNull()
    expect(normalizeUpc(null)).toBeNull()
    expect(normalizeUpc('123456789012345')).toBeNull() // 15 digits
  })
  it('accepts EAN-8, UPC-A, EAN-13, ITF-14 lengths', () => {
    expect(normalizeUpc('96385074')).toBe('96385074') // 8
    expect(normalizeUpc('036000291452')).toBe('036000291452') // 12
    expect(normalizeUpc('4006381333931')).toBe('4006381333931') // 13
    expect(normalizeUpc('00012345678905')).toBe('00012345678905') // 14
  })
})

describe('upcKey', () => {
  it('matches the same GTIN across leading-zero widths', () => {
    expect(upcKey('0016000275287')).toBe(upcKey('16000275287'))
    expect(upcKey('036000291452')).toBe(upcKey('0036000291452'))
  })
  it('returns empty for junk', () => {
    expect(upcKey('')).toBe('')
    expect(upcKey(null)).toBe('')
  })
})

describe('findFoodByUpc', () => {
  const foods = [
    { id: 'a', name: 'Bar', upc: '016000275287' },
    { id: 'b', name: 'Milk', upc: null },
    { id: 'c', name: 'Other', upc: '036000291452' },
  ]
  it('finds a food by matching UPC, zero-robust', () => {
    expect(findFoodByUpc(foods, '0016000275287')?.id).toBe('a')
    expect(findFoodByUpc(foods, '16000275287')?.id).toBe('a')
  })
  it('returns null when not present or upc missing', () => {
    expect(findFoodByUpc(foods, '99999999999')).toBeNull()
    expect(findFoodByUpc(foods, null)).toBeNull()
  })
})

describe('plausibleMacros', () => {
  it('accepts a normal protein-bar panel (per 100 g)', () => {
    // A typical bar: ~380 kcal, 33P 40C 13F per 100 g
    expect(plausibleMacros({ calories: 380, protein: 33, carbs: 40, fat: 13 }).ok).toBe(true)
  })
  it('accepts pure fat like olive oil', () => {
    expect(plausibleMacros({ calories: 884, protein: 0, carbs: 0, fat: 100 }).ok).toBe(true)
  })
  it('rejects macros summing past 100 g per 100 g', () => {
    expect(plausibleMacros({ calories: 400, protein: 60, carbs: 60, fat: 20 }).ok).toBe(false)
  })
  it('rejects calories wildly off Atwater math', () => {
    // 5g P + 5g C + 1g F ≈ 49 kcal, but claims 500
    expect(plausibleMacros({ calories: 500, protein: 5, carbs: 5, fat: 1 }).ok).toBe(false)
  })
  it('is lenient when calories are unknown (0)', () => {
    expect(plausibleMacros({ calories: 0, protein: 10, carbs: 20, fat: 5 }).ok).toBe(true)
  })
})
