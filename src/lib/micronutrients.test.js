import { describe, it, expect } from 'vitest'
import {
  dayMicronutrients,
  effectiveTargets,
  micronutrientRows,
  nutrientContributors,
  foodsMissingNutrient,
  vitaminAForm,
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

  it('labels vitamin A contributors by form from their raw retinol/carotene rows', () => {
    // Liver: essentially all preformed retinol. Carrot: essentially all
    // beta-carotene. The RAE total (id row) is unchanged; only the form differs.
    const liver = {
      id: 'f-liver-a',
      name: 'Beef liver',
      source: 'usda',
      nutrients: [
        { name: 'Vitamin A, RAE', amount: 9000, unit: 'mcg', per: '100g', usda_number: '320' },
        { name: 'Retinol', amount: 9000, unit: 'mcg', per: '100g', usda_number: '319' },
        { name: 'Carotene, beta', amount: 0, unit: 'mcg', per: '100g', usda_number: '321' },
        { id: 'vitamin_a', amount: 9000, unit: 'mcg', per: 'serving' },
      ],
    }
    const carrot = {
      id: 'f-carrot-a',
      name: 'Carrot',
      source: 'usda',
      nutrients: [
        { name: 'Vitamin A, RAE', amount: 835, unit: 'mcg', per: '100g', usda_number: '320' },
        { name: 'Retinol', amount: 0, unit: 'mcg', per: '100g', usda_number: '319' },
        { name: 'Carotene, beta', amount: 8285, unit: 'mcg', per: '100g', usda_number: '321' },
        { id: 'vitamin_a', amount: 835, unit: 'mcg', per: 'serving' },
      ],
    }
    const map = new Map([['f-liver-a', liver], ['f-carrot-a', carrot]])
    const logs = [
      { food_id: 'f-liver-a', servings: 1 },
      { food_id: 'f-carrot-a', servings: 1 },
    ]
    const { contributors } = nutrientContributors('vitamin_a', logs, map)
    expect(contributors.find((c) => c.foodId === 'f-liver-a').form).toBe('preformed')
    expect(contributors.find((c) => c.foodId === 'f-carrot-a').form).toBe('plant')
  })
})

describe('vitaminAForm', () => {
  const withRaw = (retinol, carotene) => ({
    source: 'usda',
    nutrients: [
      { name: 'Retinol', amount: retinol, unit: 'mcg', per: '100g', usda_number: '319' },
      { name: 'Carotene, beta', amount: carotene, unit: 'mcg', per: '100g', usda_number: '321' },
    ],
  })

  it('calls a retinol-dominated food preformed (beta-carotene is 12:1 by RAE)', () => {
    // 100 mcg retinol vs 100 mcg carotene = 8.3 mcg RAE → overwhelmingly retinol.
    expect(vitaminAForm(withRaw(100, 100))).toBe('preformed')
  })

  it('calls a carotene-only food plant-source', () => {
    expect(vitaminAForm(withRaw(0, 5000))).toBe('plant')
  })

  it('calls a genuinely balanced RAE split mixed', () => {
    // 600 mcg carotene → 50 mcg RAE, matched by 50 mcg retinol.
    expect(vitaminAForm(withRaw(50, 600))).toBe('mixed')
  })

  it('returns null when the food gives no retinol/carotene breakdown', () => {
    expect(vitaminAForm({ source: 'supplement_scan', nutrients: [{ id: 'vitamin_a', amount: 900, unit: 'mcg', per: 'serving' }] })).toBeNull()
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
    // 33 catalog nutrients, minus EPA/DHA (folded into EPA+DHA) and the retired
    // face-value omega-3 total, plus the synthetic EPA+DHA row = 31.
    const rows = micronutrientRows([], foodsById, null)
    expect(rows.length).toBe(31)
    expect(rows[0].id).toBe('vitamin_a')
    // EPA/DHA never appear as standalone rows.
    expect(rows.find((r) => r.id === 'epa')).toBeUndefined()
    expect(rows.find((r) => r.id === 'dha')).toBeUndefined()
    // The face-value ALA+EPA+DHA total is retired from display.
    expect(rows.find((r) => r.id === 'omega_3_total')).toBeUndefined()
    // EPA+DHA leads the omega-3 group as the primary row; ALA follows, subordinate.
    const iEpaDha = rows.findIndex((r) => r.id === 'epa_dha')
    expect(rows[iEpaDha].omegaRole).toBe('primary')
    expect(rows[iEpaDha + 1].id).toBe('ala')
    expect(rows[iEpaDha + 1].omegaRole).toBe('secondary')
  })

  it('shows EPA+DHA as the preformed primary row and ALA as a subordinate row', () => {
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
    // No single face-value total (would be 3.8 g summing ALA at face value).
    expect(rows.find((r) => r.id === 'omega_3_total')).toBeUndefined()
    const epaDha = rows.find((r) => r.id === 'epa_dha')
    const ala = rows.find((r) => r.id === 'ala')
    // EPA+DHA = (0.6 + 1.2) × 2 = 3.6 g — informational (reference, no bar/target).
    expect(epaDha.amount).toBeCloseTo(3.6, 6)
    expect(epaDha.informational).toBe(true)
    expect(epaDha.target).toBeNull()
    expect(epaDha.omegaRole).toBe('primary')
    expect(epaDha.reference).toMatch(/250/)
    // ALA is a real AI-target row (1.6 g male), subordinate, labeled poorly-converting.
    expect(ala.informational).toBe(false)
    expect(ala.target).toBe(1.6)
    expect(ala.amount).toBeCloseTo(0.2, 6)
    expect(ala.omegaRole).toBe('secondary')
    expect(ala.subtitle).toMatch(/converts/)
    expect(ala.groupNote).toBeTruthy()
  })

  it('gives a whole-egg + salmon day a sensible preformed EPA+DHA total', () => {
    const egg = {
      id: 'f-egg-o',
      source: 'usda',
      nutrients: [
        { id: 'dha', amount: 0.03, unit: 'g', per: 'serving' },
        { id: 'ala', amount: 0.01, unit: 'g', per: 'serving' },
      ],
    }
    const salmon = {
      id: 'f-salmon-o',
      source: 'usda',
      nutrients: [
        { id: 'epa', amount: 0.69, unit: 'g', per: 'serving' },
        { id: 'dha', amount: 0.82, unit: 'g', per: 'serving' },
        { id: 'ala', amount: 0.1, unit: 'g', per: 'serving' },
      ],
    }
    const rows = micronutrientRows(
      [
        { food_id: 'f-egg-o', servings: 1, calories: 78 },
        { food_id: 'f-salmon-o', servings: 1, calories: 200 },
      ],
      new Map([['f-egg-o', egg], ['f-salmon-o', salmon]]),
      { sex: 'male', micro_targets: {} }
    )
    const epaDha = rows.find((r) => r.id === 'epa_dha')
    const ala = rows.find((r) => r.id === 'ala')
    // Preformed EPA+DHA = 0.69 + (0.82 + 0.03) = 1.54 g — sensible, salmon-dominated.
    expect(epaDha.amount).toBeCloseTo(1.54, 6)
    // ALA (plant) stays a small, separate row — never folded into EPA+DHA.
    expect(ala.amount).toBeCloseTo(0.11, 6)
  })

  it('retires the face-value omega-3 total from display but keeps the raw sum', () => {
    // A gummy that only prints a combined "Omega-3" number → omega_3_total id.
    const gummy = {
      id: 'f-gummy',
      source: 'label_scan',
      nutrients: [{ id: 'omega_3_total', amount: 0.9, unit: 'g', per: 'serving' }],
    }
    const map = new Map([['f-gummy', gummy]])
    const logs = [{ food_id: 'f-gummy', servings: 1, calories: 30 }]
    const rows = micronutrientRows(logs, map, { sex: 'male', micro_targets: {} })
    // No standalone omega-3 total row is displayed anymore.
    expect(rows.find((r) => r.id === 'omega_3_total')).toBeUndefined()
    // No specific acids logged → the EPA+DHA row is zero.
    expect(rows.find((r) => r.id === 'epa_dha').amount).toBe(0)
    // Raw data is still aggregated (retained, just not shown as a summed row).
    const { totals } = dayMicronutrients(logs, map)
    expect(totals.get('omega_3_total')).toBeCloseTo(0.9, 6)
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
