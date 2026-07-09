import { describe, it, expect } from 'vitest'
import { buildEnrichment, existingMicroIds, missingCanonicalNutrients } from './foodEnrich'

// A branded egg the label only prints calories/protein + sodium for.
const brandedEgg = {
  id: 1,
  name: "Eggland's Best Large Eggs",
  serving_desc: '1 egg (50 g)',
  calories: 70,
  protein: 6,
  nutrients: [
    { name: 'Sodium', amount: 70, unit: 'mg' },
    { id: 'sodium', amount: 70, unit: 'mg', per: 'serving' },
  ],
}

// A generic whole-egg USDA detail (per-100 g raw rows), with choline the label lacks.
const genericEggDetail = {
  fdcId: '748967',
  nutrients: [
    { usda_number: '301', name: 'Calcium', amount: 56, unit: 'MG' }, // → 28 mg / 50 g
    { usda_number: '421', name: 'Choline', amount: 294, unit: 'MG' }, // → 147 mg / 50 g
    { usda_number: '307', name: 'Sodium', amount: 142, unit: 'MG' }, // already have → skipped
  ],
}

describe('existingMicroIds', () => {
  it('returns only the normalized id-bearing rows', () => {
    expect([...existingMicroIds(brandedEgg)]).toEqual(['sodium'])
  })
})

describe('buildEnrichment', () => {
  it('fills only missing nutrients, scaled to the branded serving, tagged with the source', () => {
    const built = buildEnrichment(brandedEgg, genericEggDetail)
    expect(built).not.toBeNull()
    expect(built.servingGrams).toBe(50)
    const ids = built.added.map((a) => a.id).sort()
    expect(ids).toEqual(['calcium', 'choline'])
    // sodium was already present, so it is not re-added
    expect(ids).not.toContain('sodium')
    // scaled per 50 g serving (÷2 from per-100 g)
    const choline = built.added.find((a) => a.id === 'choline')
    expect(choline.amount).toBeCloseTo(147, 1)
    // every borrowed row carries provenance and the label's own rows are kept
    const borrowed = built.nutrients.filter((r) => r.enriched_from)
    expect(borrowed.every((r) => r.enriched_from === '748967')).toBe(true)
    expect(built.nutrients).toEqual(expect.arrayContaining(brandedEgg.nutrients))
  })

  it('returns null when the serving has no gram weight to scale by', () => {
    const noGrams = { ...brandedEgg, serving_desc: '1 egg' }
    expect(buildEnrichment(noGrams, genericEggDetail)).toBeNull()
  })

  it('returns null when there is nothing new to add', () => {
    const soleSodium = { fdcId: '1', nutrients: [{ usda_number: '307', name: 'Sodium', amount: 100, unit: 'MG' }] }
    expect(buildEnrichment(brandedEgg, soleSodium)).toBeNull()
  })
})

describe('missingCanonicalNutrients', () => {
  it('excludes nutrients the food already reports', () => {
    const missing = missingCanonicalNutrients(brandedEgg).map((n) => n.id)
    expect(missing).not.toContain('sodium')
    expect(missing).toContain('choline')
  })
})
