import { describe, it, expect } from 'vitest'
import {
  dayMicronutrients,
  effectiveTargets,
  micronutrientRows,
  COVERAGE_THRESHOLD,
} from './micronutrients'

// A USDA salmon whose normalized rows report vitamin D (per serving).
const salmon = {
  id: 'f-salmon',
  source: 'usda',
  nutrients: [
    { name: 'Vitamin D', amount: 10, unit: 'MCG', per: '100g', usda_number: '328' }, // raw, ignored
    { id: 'vitamin_d', amount: 15, unit: 'mcg', per: 'serving' },
    { id: 'zinc', amount: 0.5, unit: 'mg', per: 'serving' },
  ],
}
// A scanned D3 supplement, per serving.
const d3 = {
  id: 'f-d3',
  source: 'supplement_scan',
  nutrients: [{ id: 'vitamin_d', amount: 50, unit: 'mcg', per: 'serving' }],
}
// A plain food with no micronutrient profile (hand-entered).
const toast = { id: 'f-toast', source: 'manual', nutrients: null }

const foodsById = new Map([
  ['f-salmon', salmon],
  ['f-d3', d3],
  ['f-toast', toast],
])

describe('dayMicronutrients', () => {
  it('sums normalized micros across logs, scaled by servings, by id', () => {
    const logs = [
      { food_id: 'f-salmon', servings: 2, calories: 300 }, // vitamin_d 30, zinc 1
      { food_id: 'f-d3', servings: 1, calories: 0 }, //        vitamin_d 50
    ]
    const { totals } = dayMicronutrients(logs, foodsById)
    expect(totals.get('vitamin_d')).toBeCloseTo(80, 6) // 15×2 + 50
    expect(totals.get('zinc')).toBeCloseTo(1, 6) // 0.5×2
  })

  it('ignores raw (non-id) rows and logs whose food has no profile', () => {
    const logs = [{ food_id: 'f-toast', servings: 1, calories: 200 }]
    const { totals } = dayMicronutrients(logs, foodsById)
    expect(totals.size).toBe(0)
  })

  it('computes coverage as the calorie share of reporting foods', () => {
    // 300 kcal of salmon (reports vitamin_d) + 200 kcal of un-profiled toast.
    const logs = [
      { food_id: 'f-salmon', servings: 1, calories: 300 },
      { food_id: 'f-toast', servings: 1, calories: 200 },
    ]
    const { coverage } = dayMicronutrients(logs, foodsById)
    expect(coverage.get('vitamin_d')).toBeCloseTo(300 / 500, 6) // 0.6 → below threshold
    expect(coverage.get('vitamin_d')).toBeLessThan(COVERAGE_THRESHOLD)
  })

  it('reports full coverage when the day has no calories to weigh', () => {
    const logs = [{ food_id: 'f-d3', servings: 1, calories: 0 }]
    const { coverage, dayCalories } = dayMicronutrients(logs, foodsById)
    expect(dayCalories).toBe(0)
    expect(coverage.get('vitamin_d')).toBe(1)
  })
})

describe('effectiveTargets', () => {
  it('uses cohort defaults when there are no overrides', () => {
    const eff = effectiveTargets({ sex: 'female', micro_targets: {} })
    expect(eff.iron.target).toBe(18)
  })

  it('lets a per-nutrient override win over the default', () => {
    const eff = effectiveTargets({ sex: 'male', micro_targets: { vitamin_c: { target: 500, upper_limit: 2000 } } })
    expect(eff.vitamin_c.target).toBe(500)
    expect(eff.iron.target).toBe(8) // untouched → male default
  })

  it('treats a null override target as "no target"', () => {
    const eff = effectiveTargets({ sex: 'male', micro_targets: { zinc: { target: null, upper_limit: null } } })
    expect(eff.zinc.target).toBeNull()
  })
})

describe('micronutrientRows', () => {
  it('flags a nutrient pushed past its upper limit', () => {
    // 41 mg zinc from a mega-dose supplement; male UL is 40.
    const zincBomb = { id: 'f-zinc', source: 'supplement_scan', nutrients: [{ id: 'zinc', amount: 41, unit: 'mg', per: 'serving' }] }
    const rows = micronutrientRows(
      [{ food_id: 'f-zinc', servings: 1, calories: 0 }],
      new Map([['f-zinc', zincBomb]]),
      { sex: 'male', micro_targets: {} }
    )
    const zinc = rows.find((r) => r.id === 'zinc')
    expect(zinc.overUL).toBe(true)
  })

  it('marks a low-coverage nutrient', () => {
    const rows = micronutrientRows(
      [
        { food_id: 'f-salmon', servings: 1, calories: 300 },
        { food_id: 'f-toast', servings: 1, calories: 700 },
      ],
      foodsById,
      { sex: 'neutral', micro_targets: {} }
    )
    const vitD = rows.find((r) => r.id === 'vitamin_d')
    expect(vitD.lowCoverage).toBe(true) // 300/1000 = 0.3
  })

  it('returns a row for every catalog nutrient in curated order', () => {
    const rows = micronutrientRows([], foodsById, null)
    expect(rows.length).toBe(29)
    expect(rows[0].id).toBe('vitamin_a')
  })

  it('tracks a limit nutrient and flags it over the cap', () => {
    // 25 g saturated fat in a serving; the default limit is 20 g.
    const fatty = {
      id: 'f-butter',
      source: 'label_scan',
      nutrients: [{ id: 'saturated_fat', amount: 25, unit: 'g', per: 'serving' }],
    }
    const rows = micronutrientRows(
      [{ food_id: 'f-butter', servings: 1, calories: 200 }],
      new Map([['f-butter', fatty]]),
      { sex: 'neutral', micro_targets: {} }
    )
    const sat = rows.find((r) => r.id === 'saturated_fat')
    expect(sat.kind).toBe('limit')
    expect(sat.amount).toBe(25)
    expect(sat.upperLimit).toBe(20)
    expect(sat.overUL).toBe(true)
  })
})
