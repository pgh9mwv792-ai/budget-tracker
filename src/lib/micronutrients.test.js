import { describe, it, expect } from 'vitest'
import {
  dayMicronutrients,
  effectiveTargets,
  micronutrientRows,
  nutrientContributors,
  foodsMissingNutrient,
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

describe('nutrientContributors', () => {
  // Two eggs (one label-scanned with choline borrowed from a generic) + toast.
  const egg = {
    id: 'f-egg',
    name: 'Pasture eggs',
    source: 'label_scan',
    nutrients: [{ id: 'choline', amount: 140, unit: 'mg', per: 'serving', enriched_from: '748967' }],
  }
  const liver = {
    id: 'f-liver',
    name: 'Beef liver',
    source: 'usda',
    nutrients: [{ id: 'choline', amount: 300, unit: 'mg', per: 'serving' }],
  }
  const toast = { id: 'f-toast', name: 'Toast', source: 'manual', nutrients: null }
  const map = new Map([
    ['f-egg', egg],
    ['f-liver', liver],
    ['f-toast', toast],
  ])

  it('ranks contributing foods by amount with their share of the total', () => {
    const logs = [
      { food_id: 'f-egg', name: 'Pasture eggs', servings: 2 }, // 280
      { food_id: 'f-liver', name: 'Beef liver', servings: 1 }, // 300
      { food_id: 'f-toast', name: 'Toast', servings: 1 },
    ]
    const { total, contributors, notReported } = nutrientContributors('choline', logs, map)
    expect(total).toBe(580)
    expect(contributors.map((c) => c.name)).toEqual(['Beef liver', 'Pasture eggs'])
    expect(contributors[0].pct).toBeCloseTo((300 / 580) * 100, 4)
    // The label-scanned egg's choline is borrowed → carries the marker.
    expect(contributors.find((c) => c.foodId === 'f-egg').markers.borrowed).toBe(true)
    // Toast reports no choline → shows up under "not reported by".
    expect(notReported.map((f) => f.name)).toEqual(['Toast'])
  })

  it('sums rollup components (EPA+DHA+ALA) per food for the omega-3 total', () => {
    const salmon = {
      id: 'f-salmon',
      name: 'Salmon',
      source: 'usda',
      nutrients: [
        { id: 'epa', amount: 0.5, unit: 'g', per: 'serving' },
        { id: 'dha', amount: 1.0, unit: 'g', per: 'serving' },
        { id: 'ala', amount: 0.1, unit: 'g', per: 'serving' },
      ],
    }
    const { contributors } = nutrientContributors(
      'omega_3_total',
      [{ food_id: 'f-salmon', name: 'Salmon', servings: 1 }],
      new Map([['f-salmon', salmon]])
    )
    expect(contributors[0].amount).toBeCloseTo(1.6, 6)
  })
})

describe('foodsMissingNutrient', () => {
  it('lists logged foods that do not report the nutrient', () => {
    const egg = { id: 'f-egg', name: 'Eggs', source: 'label_scan', nutrients: [{ id: 'choline', amount: 140, unit: 'mg', per: 'serving' }] }
    const yogurt = { id: 'f-yog', name: 'Yogurt', source: 'label_scan', nutrients: [{ id: 'calcium', amount: 200, unit: 'mg', per: 'serving' }] }
    const map = new Map([['f-egg', egg], ['f-yog', yogurt]])
    const logs = [
      { food_id: 'f-egg', servings: 1 },
      { food_id: 'f-yog', servings: 1 },
    ]
    const missing = foodsMissingNutrient('choline', logs, map)
    expect(missing.map((f) => f.name)).toEqual(['Yogurt'])
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

  it('returns a row for every displayed nutrient in curated order', () => {
    // 33 catalog nutrients, minus EPA/DHA (folded into rollups), plus the
    // synthetic EPA+DHA row = 32.
    const rows = micronutrientRows([], foodsById, null)
    expect(rows.length).toBe(32)
    expect(rows[0].id).toBe('vitamin_a')
    // EPA/DHA never appear as standalone rows.
    expect(rows.find((r) => r.id === 'epa')).toBeUndefined()
    expect(rows.find((r) => r.id === 'dha')).toBeUndefined()
    // The Omega-3 total is immediately followed by the EPA+DHA rollup.
    const iTotal = rows.findIndex((r) => r.id === 'omega_3_total')
    expect(rows[iTotal + 1].id).toBe('epa_dha')
  })

  it('rolls EPA + DHA + ALA into the informational omega-3 rows', () => {
    // A USDA salmon reporting all three specific omega-3 acids (per serving, g).
    const omegaFish = {
      id: 'f-omega',
      source: 'usda',
      nutrients: [
        { id: 'epa', amount: 0.6, unit: 'g', per: 'serving' },
        { id: 'dha', amount: 1.2, unit: 'g', per: 'serving' },
        { id: 'ala', amount: 0.1, unit: 'g', per: 'serving' },
      ],
    }
    const rows = micronutrientRows(
      [{ food_id: 'f-omega', servings: 2, calories: 200 }],
      new Map([['f-omega', omegaFish]]),
      { sex: 'male', micro_targets: {} }
    )
    const total = rows.find((r) => r.id === 'omega_3_total')
    const epaDha = rows.find((r) => r.id === 'epa_dha')
    const ala = rows.find((r) => r.id === 'ala')
    // total = (0.6 + 1.2 + 0.1) × 2 = 3.8 g ; EPA+DHA = (0.6 + 1.2) × 2 = 3.6 g
    expect(total.amount).toBeCloseTo(3.8, 6)
    expect(total.informational).toBe(true)
    expect(total.target).toBeNull()
    expect(epaDha.amount).toBeCloseTo(3.6, 6)
    expect(epaDha.informational).toBe(true)
    // ALA is a real target row (AI 1.6 g male), not informational.
    expect(ala.informational).toBe(false)
    expect(ala.target).toBe(1.6)
    expect(ala.amount).toBeCloseTo(0.2, 6)
  })

  it('folds a generic Omega-3 bucket into the total', () => {
    // A gummy that only prints a combined "Omega-3" number → omega_3_total id.
    const gummy = {
      id: 'f-gummy',
      source: 'label_scan',
      nutrients: [{ id: 'omega_3_total', amount: 0.9, unit: 'g', per: 'serving' }],
    }
    const rows = micronutrientRows(
      [{ food_id: 'f-gummy', servings: 1, calories: 30 }],
      new Map([['f-gummy', gummy]]),
      { sex: 'male', micro_targets: {} }
    )
    expect(rows.find((r) => r.id === 'omega_3_total').amount).toBeCloseTo(0.9, 6)
    // No specific acids logged → EPA+DHA rollup is zero.
    expect(rows.find((r) => r.id === 'epa_dha').amount).toBe(0)
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
