import { describe, it, expect } from 'vitest'
import {
  normalizeNutrient,
  normalizeFoodNutrients,
  servingScaleForFood,
  defaultTarget,
  defaultTargets,
  splitForm,
  NUTRIENTS,
} from './nutrients'

describe('normalizeNutrient — USDA number mapping', () => {
  it('maps USDA nutrient numbers to canonical ids', () => {
    expect(normalizeNutrient('401', 90, 'MG', 'usda')).toEqual({ id: 'vitamin_c', amount: 90, unit: 'mg' })
    expect(normalizeNutrient('418', 2.4, 'UG', 'usda')).toEqual({ id: 'b12', amount: 2.4, unit: 'mcg' })
    expect(normalizeNutrient('301', 200, 'MG', 'usda')).toEqual({ id: 'calcium', amount: 200, unit: 'mg' })
  })

  it('passes USDA folate number 435 through as DFE (no 1.7 factor)', () => {
    expect(normalizeNutrient('435', 100, 'UG', 'usda')).toEqual({ id: 'folate', amount: 100, unit: 'mcg' })
  })

  it('returns null for an unknown USDA number', () => {
    expect(normalizeNutrient('999', 5, 'mg', 'usda')).toBeNull()
  })
})

describe('normalizeNutrient — label alias matching', () => {
  it('converges three B12 spellings to the same id', () => {
    const a = normalizeNutrient('Vitamin B-12', 500, 'mcg', 'label')
    const b = normalizeNutrient('B12', 500, 'mcg', 'label')
    const c = normalizeNutrient('Cobalamin', 500, 'mcg', 'label')
    expect(a.id).toBe('b12')
    expect(b.id).toBe('b12')
    expect(c.id).toBe('b12')
  })

  it('matches the base name and ignores a parenthesized form', () => {
    const r = normalizeNutrient('Vitamin B12 (as methylcobalamin)', 1000, 'mcg', 'label')
    expect(r).toEqual({ id: 'b12', amount: 1000, unit: 'mcg' })
  })

  it('matches a bare chemical form with no vitamin prefix', () => {
    expect(normalizeNutrient('Pyridoxine HCl', 10, 'mg', 'label').id).toBe('b6')
    expect(normalizeNutrient('Cholecalciferol', 25, 'mcg', 'label').id).toBe('vitamin_d')
  })

  it('returns null for an unmappable ingredient name', () => {
    expect(normalizeNutrient('Proprietary Herbal Blend', 450, 'mg', 'label')).toBeNull()
  })
})

describe('normalizeNutrient — folic acid → DFE', () => {
  it('multiplies label folic acid by 1.7 to reach mcg DFE', () => {
    const r = normalizeNutrient('Folic Acid', 400, 'mcg', 'label')
    expect(r.id).toBe('folate')
    expect(r.amount).toBeCloseTo(680, 5) // 400 × 1.7
  })

  it('does NOT apply 1.7 to natural folate/methylfolate labels', () => {
    expect(normalizeNutrient('Folate', 400, 'mcg', 'label').amount).toBe(400)
    expect(normalizeNutrient('L-Methylfolate', 400, 'mcg', 'label').amount).toBe(400)
  })
})

describe('normalizeNutrient — IU conversions', () => {
  it('converts vitamin D IU to mcg (40 IU = 1 mcg)', () => {
    expect(normalizeNutrient('Vitamin D3', 1000, 'IU', 'label').amount).toBeCloseTo(25, 5)
  })

  it('converts vitamin A IU to mcg RAE (1 IU = 0.3 mcg)', () => {
    expect(normalizeNutrient('Vitamin A', 5000, 'IU', 'label').amount).toBeCloseTo(1500, 5)
  })

  it('converts vitamin E IU to mg (1 IU = 0.67 mg)', () => {
    expect(normalizeNutrient('Vitamin E', 30, 'IU', 'label').amount).toBeCloseTo(20.1, 5)
  })

  it('refuses IU for a nutrient with no standard IU factor', () => {
    expect(normalizeNutrient('Vitamin C', 100, 'IU', 'label')).toBeNull()
  })
})

describe('normalizeNutrient — mass unit conversions', () => {
  it('converts g and mg into a mcg-canonical nutrient', () => {
    expect(normalizeNutrient('Vitamin B12', 0.001, 'mg', 'label').amount).toBeCloseTo(1, 6)
    expect(normalizeNutrient('Selenium', 0.00005, 'g', 'label').amount).toBeCloseTo(50, 6)
  })

  it('converts mcg into an mg-canonical nutrient', () => {
    expect(normalizeNutrient('Zinc', 15000, 'mcg', 'label').amount).toBeCloseTo(15, 6)
  })

  it('returns null for a missing/garbage amount', () => {
    expect(normalizeNutrient('Zinc', null, 'mg', 'label')).toBeNull()
    expect(normalizeNutrient('Zinc', 'n/a', 'mg', 'label')).toBeNull()
  })
})

describe('normalizeFoodNutrients', () => {
  it('scales USDA per-100g rows to a serving and sums by id', () => {
    // A 200 g serving → servingScale 2. Two vitamin C rows should sum.
    const raw = [
      { name: 'Vitamin C', amount: 10, unit: 'MG', per: '100g', usda_number: '401' },
      { name: 'Sodium', amount: 50, unit: 'MG', per: '100g', usda_number: '307' },
      { name: 'Some unmapped thing', amount: 5, unit: 'MG', per: '100g', usda_number: '9999' },
    ]
    const out = normalizeFoodNutrients(raw, { source: 'usda', servingScale: 2 })
    const byId = Object.fromEntries(out.map((e) => [e.id, e]))
    expect(byId.vitamin_c).toEqual({ id: 'vitamin_c', amount: 20, unit: 'mg', per: 'serving' })
    expect(byId.sodium.amount).toBe(100)
    expect(out.every((e) => e.per === 'serving')).toBe(true)
    expect(out.find((e) => e.id === undefined)).toBeUndefined()
  })

  it('keeps supplement per-serving rows as-is (scale 1) and matches by name', () => {
    const raw = [
      { name: 'Vitamin D3 (as cholecalciferol)', amount: 2000, unit: 'IU', per: 'serving' },
      { name: 'Vitamin K2 (as MK-7)', amount: 90, unit: 'mcg', per: 'serving' },
    ]
    const out = normalizeFoodNutrients(raw, { source: 'supplement_scan', servingScale: 1 })
    const byId = Object.fromEntries(out.map((e) => [e.id, e]))
    expect(byId.vitamin_d.amount).toBeCloseTo(50, 5) // 2000 IU → 50 mcg
    expect(byId.vitamin_k.amount).toBe(90)
  })

  it('takes the MAX across redundant USDA rows (name-only, no numbers)', () => {
    // An old USDA food with folate reported three redundant ways — should count once.
    const raw = [
      { name: 'Folate, DFE', amount: 100, unit: 'UG', per: '100g' },
      { name: 'Folate, total', amount: 60, unit: 'UG', per: '100g' },
      { name: 'Folate, food', amount: 60, unit: 'UG', per: '100g' },
    ]
    const out = normalizeFoodNutrients(raw, { source: 'usda', servingScale: 1 })
    expect(out).toEqual([{ id: 'folate', amount: 100, unit: 'mcg', per: 'serving' }])
  })

  it('skips redundant USDA IU rows so vitamin A is not double-counted', () => {
    const raw = [
      { name: 'Vitamin A, RAE', amount: 50, unit: 'UG', per: '100g', usda_number: '320' },
      { name: 'Vitamin A, IU', amount: 900, unit: 'IU', per: '100g', usda_number: '318' },
    ]
    const out = normalizeFoodNutrients(raw, { source: 'usda', servingScale: 2 })
    expect(out).toEqual([{ id: 'vitamin_a', amount: 100, unit: 'mcg', per: 'serving' }])
  })

  it('is idempotent — already-normalized (id) rows are skipped', () => {
    const raw = [
      { name: 'Zinc', amount: 5000, unit: 'mcg', per: 'serving' },
      { id: 'zinc', amount: 5, unit: 'mg', per: 'serving' },
    ]
    const out = normalizeFoodNutrients(raw, { source: 'supplement_scan', servingScale: 1 })
    expect(out).toEqual([{ id: 'zinc', amount: 5, unit: 'mg', per: 'serving' }])
  })
})

describe('servingScaleForFood', () => {
  it('recovers the serving fraction from calories ÷ energy-per-100g for USDA foods', () => {
    // 208 kcal/100g salmon logged as a 150 g serving → 312 kcal → scale 1.5.
    const food = {
      source: 'usda',
      calories: 312,
      serving_desc: '150 g',
      nutrients: [{ name: 'Energy', amount: 208, unit: 'KCAL', per: '100g', usda_number: '208' }],
    }
    expect(servingScaleForFood(food)).toBeCloseTo(1.5, 5)
  })

  it('falls back to grams parsed from serving_desc when energy is missing', () => {
    const food = { source: 'usda', calories: 0, serving_desc: '1 large (50 g)', nutrients: [] }
    expect(servingScaleForFood(food)).toBeCloseTo(0.5, 5)
  })

  it('returns 1 for non-USDA (already per-serving) foods', () => {
    expect(servingScaleForFood({ source: 'supplement_scan', nutrients: [] })).toBe(1)
  })

  it('returns null when a USDA food gives no way to derive the scale', () => {
    expect(servingScaleForFood({ source: 'usda', calories: 0, serving_desc: '', nutrients: [] })).toBeNull()
  })
})

describe('splitForm', () => {
  it('separates the base name from a parenthesized form', () => {
    expect(splitForm('Vitamin B12 (as methylcobalamin)')).toEqual({
      base: 'Vitamin B12',
      form: 'as methylcobalamin',
    })
    expect(splitForm('Zinc')).toEqual({ base: 'Zinc', form: null })
  })
})

describe('defaultTargets', () => {
  it('gives sex-specific RDAs', () => {
    expect(defaultTarget('iron', 'male').target).toBe(8)
    expect(defaultTarget('iron', 'female').target).toBe(18)
  })

  it('averages male/female for a neutral cohort', () => {
    expect(defaultTarget('iron', 'neutral').target).toBe(13)
  })

  it('includes ULs for the required nutrients', () => {
    for (const id of ['vitamin_a', 'vitamin_d', 'vitamin_e', 'b6', 'folate', 'zinc', 'copper', 'selenium', 'iron', 'calcium', 'iodine', 'sodium']) {
      expect(defaultTarget(id, 'male').upper_limit).toBeGreaterThan(0)
    }
  })

  it('covers every catalog nutrient', () => {
    const all = defaultTargets('female')
    for (const n of NUTRIENTS) expect(all[n.id]).toBeDefined()
  })
})
