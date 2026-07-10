import { describe, it, expect } from 'vitest'
import { parseFoodCsv, normalizeImportDate, normalizeMeal } from './foodImport'

describe('normalizeImportDate', () => {
  it('passes through ISO dates', () => {
    expect(normalizeImportDate('2024-01-15')).toBe('2024-01-15')
  })
  it('parses human date formats', () => {
    expect(normalizeImportDate('January 15, 2024')).toBe('2024-01-15')
    expect(normalizeImportDate('1/15/2024')).toBe('2024-01-15')
  })
  it('returns null for empty/garbage', () => {
    expect(normalizeImportDate('')).toBeNull()
    expect(normalizeImportDate('not a date')).toBeNull()
  })
})

describe('normalizeMeal', () => {
  it('maps known meal labels', () => {
    expect(normalizeMeal('Breakfast')).toBe('breakfast')
    expect(normalizeMeal('Snacks')).toBe('snack')
  })
  it('returns null for unknown/blank groups', () => {
    expect(normalizeMeal('')).toBeNull()
    expect(normalizeMeal('Post-workout')).toBeNull()
  })
})

const MFP_CSV = `Date,Meal,Food,Calories,Fat (g),Carbohydrates (g),Protein (g)
2024-01-15,Breakfast,"Oatmeal, rolled",150,3,27,5
2024-01-15,Lunch,Chicken breast grilled,165,3.6,0,31
2024-01-15,Snacks,Water,0,0,0,0`

const CRONOMETER_CSV = `Day,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g)
2024-02-01,Breakfast,Whey protein,1 scoop,120,24,3,1.5
2024-02-01,,Banana,1 medium,105,1.3,27,0.4`

describe('parseFoodCsv — MyFitnessPal', () => {
  it('detects the format and maps rows, dropping all-zero entries', () => {
    const res = parseFoodCsv(MFP_CSV)
    expect(res.format).toBe('myfitnesspal')
    expect(res.error).toBeNull()
    expect(res.rows).toHaveLength(2) // Water row dropped
    expect(res.skipped).toBe(1)
    expect(res.rows[0]).toMatchObject({
      date: '2024-01-15',
      meal: 'breakfast',
      name: 'Oatmeal, rolled',
      calories: 150,
      protein: 5,
      carbs: 27,
      fat: 3,
    })
    expect(res.rows[1].meal).toBe('lunch')
  })
})

describe('parseFoodCsv — Cronometer', () => {
  it('detects the format, reads Energy (kcal), and leaves blank groups uncategorized', () => {
    const res = parseFoodCsv(CRONOMETER_CSV)
    expect(res.format).toBe('cronometer')
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0]).toMatchObject({ name: 'Whey protein', calories: 120, protein: 24, meal: 'breakfast' })
    expect(res.rows[1].meal).toBeNull()
    expect(res.rows[1].date).toBe('2024-02-01')
  })
})

describe('parseFoodCsv — unrecognized / empty', () => {
  it('flags a non-diary CSV', () => {
    const res = parseFoodCsv('Merchant,Amount\nWhole Foods,42.10')
    expect(res.format).toBeNull()
    expect(res.rows).toHaveLength(0)
    expect(res.error).toMatch(/MyFitnessPal or Cronometer/)
  })
  it('flags an empty file', () => {
    const res = parseFoodCsv('')
    expect(res.format).toBeNull()
    expect(res.error).toBeTruthy()
  })
})
