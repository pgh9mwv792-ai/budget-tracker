import { describe, it, expect } from 'vitest'
import { gramsBought, servingGrams, suggestFoodMapping, aggregatePantry } from './pantry'

describe('gramsBought', () => {
  it('converts mass units to grams', () => {
    expect(gramsBought(1.2, 'lb')).toBeCloseTo(544.31, 1)
    expect(gramsBought(16, 'oz')).toBeCloseTo(453.59, 1)
    expect(gramsBought(2, 'kg')).toBe(2000)
    expect(gramsBought(500, 'g')).toBe(500)
  })

  it('returns null for count/each or missing units', () => {
    expect(gramsBought(3, 'each')).toBeNull()
    expect(gramsBought(1, null)).toBeNull()
    expect(gramsBought(0, 'lb')).toBeNull()
  })
})

describe('servingGrams', () => {
  it('parses a mass serving_desc', () => {
    expect(servingGrams({ serving_desc: '100 g' })).toBe(100)
    expect(servingGrams({ serving_desc: '3 oz' })).toBeCloseTo(85.05, 1)
  })

  it('returns null for non-mass servings', () => {
    expect(servingGrams({ serving_desc: '1 cup' })).toBeNull()
    expect(servingGrams({ serving_desc: '' })).toBeNull()
    expect(servingGrams({})).toBeNull()
  })
})

describe('suggestFoodMapping', () => {
  const foods = [
    { id: 'f-chicken', name: 'Chicken breast', aliases: [], serving_desc: '100 g', protein: 31, calories: 165 },
    { id: 'f-whey', name: 'Whey protein', aliases: ['whey'], serving_desc: '30 g', protein: 24, calories: 120 },
    { id: 'f-rice', name: 'White rice', aliases: [], serving_desc: '100 g', protein: 2.7, calories: 130 },
  ]

  it('resolves an exact alias', () => {
    const s = suggestFoodMapping('WHEY', foods)
    expect(s?.food.id).toBe('f-whey')
    expect(s.via).toBe('alias')
  })

  it('expands grocery abbreviations and matches on grade/tokens', () => {
    // "CHKN BRST" → "chicken breast" via the receipt abbreviation table.
    const s = suggestFoodMapping('365 ORG CHKN BRST', foods)
    expect(s?.food.id).toBe('f-chicken')
  })

  it('returns null when nothing overlaps enough', () => {
    expect(suggestFoodMapping('PAPER TOWELS', foods)).toBeNull()
  })
})

describe('aggregatePantry', () => {
  const foodsById = new Map([
    ['f-chicken', { id: 'f-chicken', name: 'Chicken breast', serving_desc: '100 g', calories: 165, protein: 31, carbs: 0, fat: 3.6 }],
    ['f-rice', { id: 'f-rice', name: 'White rice', serving_desc: '100 g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }],
  ])

  it('rolls weight-priced food lines into protein bought and cost per 100g protein', () => {
    const items = [
      // 2 lb chicken = 907.18 g = 9.0718 servings of 100 g.
      { is_food: true, food_id: 'f-chicken', price: 12.0, quantity: 2, unit: 'lb' },
      { is_food: true, food_id: 'f-rice', price: 3.0, quantity: 1, unit: 'kg' }, // 1000 g = 10 servings
    ]
    const agg = aggregatePantry(items, foodsById)
    // chicken protein 31 * 9.0718 = 281.2, rice 2.7 * 10 = 27 → ~308.2
    expect(agg.protein).toBeCloseTo(31 * 9.0718 + 27, 1)
    expect(agg.spend).toBeCloseTo(15, 2)
    expect(agg.pricedSpend).toBeCloseTo(15, 2)
    expect(agg.coverage).toBeCloseTo(1, 5)
    expect(agg.costPer100gProtein).toBeCloseTo((15 / agg.protein) * 100, 4)
    expect(agg.itemCount).toBe(2)
    expect(agg.nutritionItemCount).toBe(2)
  })

  it('counts a count-priced line toward spend but not nutrition, lowering coverage', () => {
    const items = [
      { is_food: true, food_id: 'f-chicken', price: 12.0, quantity: 2, unit: 'lb' }, // priced + nutrition
      { is_food: true, food_id: 'f-rice', price: 4.0, quantity: 3, unit: 'each' }, // no grams → no nutrition
    ]
    const agg = aggregatePantry(items, foodsById)
    expect(agg.itemCount).toBe(2)
    expect(agg.nutritionItemCount).toBe(1)
    expect(agg.spend).toBeCloseTo(16, 2)
    expect(agg.pricedSpend).toBeCloseTo(12, 2)
    expect(agg.coverage).toBeCloseTo(12 / 16, 4)
  })

  it('ignores non-food and unmapped lines', () => {
    const items = [
      { is_food: false, food_id: null, price: 5, quantity: 1, unit: 'each' },
      { is_food: true, food_id: null, price: 5, quantity: 1, unit: 'lb' },
    ]
    const agg = aggregatePantry(items, foodsById)
    expect(agg.itemCount).toBe(0)
    expect(agg.spend).toBe(0)
    expect(agg.protein).toBe(0)
    expect(agg.costPer100gProtein).toBeNull()
  })
})
