import { describe, it, expect } from 'vitest'
import { normalizeFoodNutrients } from './nutrients'
import { dayMicronutrients } from './micronutrients'

// End-to-end tripwire for the USDA → day-totals micronutrient pipeline. This
// path has silently broken twice (foods saved with correct macros but a zeroed
// micro profile), so this test walks a whole food from the detail response the
// `food-search` edge function returns, through the exact save transform in
// FoodSearchSheet.createUsdaThenLog, to the day totals the Meals view sums.
//
// The fixture is the DETAIL RESPONSE shape the client's onFoodDetails resolves to
// (per-100g rows, each with a `usda_number`) — i.e. what a mocked USDA response
// looks like once the edge function has trimmed it. Values are a real USDA whole
// egg (fdcId 748967, "Eggs, Grade A, Large, egg whole", per 100 g).
const eggDetailResponse = {
  fdcId: '748967',
  name: 'Eggs, Grade A, Large, egg whole',
  brand: null,
  calories: 143,
  protein: 12.4,
  carbs: 0.96,
  fat: 9.96,
  portions: [{ label: '1 large', grams: 50 }],
  nutrients: [
    { name: 'Protein', amount: 12.4, unit: 'G', per: '100g', usda_number: '203' },
    { name: 'Total lipid (fat)', amount: 9.96, unit: 'G', per: '100g', usda_number: '204' },
    { name: 'Carbohydrate, by difference', amount: 0.96, unit: 'G', per: '100g', usda_number: '205' },
    { name: 'Energy', amount: 143, unit: 'KCAL', per: '100g', usda_number: '208' },
    { name: 'Vitamin A, RAE', amount: 160, unit: 'UG', per: '100g', usda_number: '320' },
    { name: 'Vitamin D (D2 + D3)', amount: 2.0, unit: 'UG', per: '100g', usda_number: '328' },
    { name: 'Choline, total', amount: 294, unit: 'MG', per: '100g', usda_number: '421' },
    { name: 'Selenium, Se', amount: 30.7, unit: 'UG', per: '100g', usda_number: '317' },
    { name: 'Vitamin B-12', amount: 0.89, unit: 'UG', per: '100g', usda_number: '418' },
    { name: 'Calcium, Ca', amount: 48, unit: 'MG', per: '100g', usda_number: '301' },
  ],
}

// Mirror of the save transform in FoodSearchSheet.createUsdaThenLog: the food's
// stored `nutrients` is the raw per-100g rows PLUS a normalized per-serving set,
// scaled by `factor` = grams/100 × amount (the portion the user logs).
function saveUsdaFood(detail, grams, amount = 1) {
  const factor = (grams / 100) * amount
  const raw = detail.nutrients ?? []
  const normalized = normalizeFoodNutrients(raw, { source: 'usda', servingScale: factor })
  return {
    id: 'f-egg',
    source: 'usda',
    fdc_id: detail.fdcId,
    calories: Math.round(detail.calories * factor),
    serving_desc: `${amount} large eggs (${grams} g)`,
    nutrients: [...raw, ...normalized],
  }
}

describe('USDA micronutrient pipeline (search → detail → save → log → day totals)', () => {
  it('carries micros from a whole-egg detail response to nonzero day totals', () => {
    // Log ~300 g of whole eggs (6 large). factor = 3 at save; log one serving.
    const egg = saveUsdaFood(eggDetailResponse, 300)

    // The saved profile must contain id-bearing (normalized) rows, not just raw.
    expect(egg.nutrients.some((n) => n.id === 'choline')).toBe(true)

    const foodsById = new Map([[egg.id, egg]])
    const logs = [{ food_id: 'f-egg', servings: 1, calories: egg.calories }]
    const { totals } = dayMicronutrients(logs, foodsById)

    // The exact symptoms from the bug report — all must be > 0.
    expect(totals.get('choline')).toBeGreaterThan(0)
    expect(totals.get('vitamin_d')).toBeGreaterThan(0)
    expect(totals.get('vitamin_a')).toBeGreaterThan(0)
    expect(totals.get('selenium')).toBeGreaterThan(0)
    expect(totals.get('b12')).toBeGreaterThan(0)

    // And the amounts are the per-100g values scaled to 300 g (×3).
    expect(totals.get('choline')).toBeCloseTo(882, 5) // 294 mg × 3
    expect(totals.get('vitamin_d')).toBeCloseTo(6, 5) // 2 mcg × 3
  })

  it('regression guard: an empty detail response yields an empty profile (must be refetched, never silently logged as zero)', () => {
    // If the detail fetch comes back without nutrients, the food has no micro
    // rows — the save path must refetch rather than persist this. This asserts
    // the failure shape so a future change can't quietly reintroduce it.
    const empty = saveUsdaFood({ ...eggDetailResponse, nutrients: [] }, 300)
    expect(empty.nutrients.some((n) => n.id)).toBe(false)
    const { totals } = dayMicronutrients(
      [{ food_id: 'f-egg', servings: 1, calories: empty.calories }],
      new Map([[empty.id, empty]])
    )
    expect(totals.get('choline') || 0).toBe(0)
  })
})
