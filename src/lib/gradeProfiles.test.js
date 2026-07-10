import { describe, it, expect } from 'vitest'
import {
  familyForText,
  gradesForText,
  gradeById,
  gradeLabel,
  gradeSearchTerm,
  rankResultsForGrade,
  applyGradeProfile,
  stripGradeProfile,
  nutrientsForGrade,
} from './gradeProfiles'

// A whole-milk food (per-serving normalized rows). 240 g serving so per-100 g
// overrides scale by 2.4.
const wholeMilk = {
  id: 10,
  name: 'Whole milk',
  serving_desc: '1 cup (240 g)',
  nutrients: [
    { name: 'Total Fat', amount: 8, unit: 'g' }, // raw row (no id) — untouched
    { id: 'omega_3_total', amount: 0.05, unit: 'g' },
    { id: 'calcium', amount: 300, unit: 'mg' },
  ],
}

describe('familyForText', () => {
  it('matches on whole-word keywords', () => {
    expect(familyForText('Whole milk')?.id).toBe('milk')
    expect(familyForText('grass-fed ground beef')?.id).toBe('beef')
    expect(familyForText('Wild Alaskan salmon')?.id).toBe('salmon')
    expect(familyForText('Large brown eggs')?.id).toBe('eggs')
  })

  it('returns null for foods that match no family', () => {
    expect(familyForText('banana')).toBeNull()
    expect(familyForText('')).toBeNull()
    expect(familyForText(null)).toBeNull()
  })
})

describe('gradesForText', () => {
  it('lists the family grades, conventional first', () => {
    const grades = gradesForText('milk').map((g) => g.id)
    expect(grades[0]).toBe('milk_whole')
    expect(grades).toContain('milk_grass_fed')
  })

  it('is empty for an unmatched food', () => {
    expect(gradesForText('tofu')).toEqual([])
  })
})

describe('gradeById / gradeLabel / gradeSearchTerm', () => {
  it('resolves a grade and its family', () => {
    expect(gradeById('beef_grass_fed')?.family).toBe('beef')
    expect(gradeLabel('salmon_wild')).toBe('Wild')
    expect(gradeById('nope')).toBeNull()
    expect(gradeLabel(null)).toBeNull()
  })

  it('returns the routing term only for Tier-1 grades', () => {
    expect(gradeSearchTerm('milk_whole')).toBe('milk whole')
    expect(gradeSearchTerm('milk_grass_fed')).toBeNull() // Tier 2, no route
    expect(gradeSearchTerm('organic')).toBeNull() // Tier 3
  })
})

describe('rankResultsForGrade', () => {
  const results = [
    { fdcId: '999', name: 'Beef, ground, raw' },
    { fdcId: '168608', name: 'Beef, grass-fed, ground, raw' },
    { fdcId: '555', name: 'Beef, grass finished, ground' },
  ]

  it('floats preferred fdcIds and keyword matches to the top, stably', () => {
    const ranked = rankResultsForGrade(results, 'beef_grass_fed')
    expect(ranked[0].fdcId).toBe('168608') // preferred id → score 2
    expect(ranked[1].fdcId).toBe('555') // "grass" keyword → score 1
    expect(ranked[2].fdcId).toBe('999') // no match → score 0
  })

  it('returns results unchanged for a grade without routing', () => {
    expect(rankResultsForGrade(results, 'milk_grass_fed')).toBe(results)
    expect(rankResultsForGrade(results, 'bogus')).toBe(results)
  })
})

describe('applyGradeProfile / stripGradeProfile round-trip', () => {
  it('overrides matching rows, scaled to serving, tagged with the profile', () => {
    const out = applyGradeProfile(wholeMilk, 'milk_grass_fed')
    expect(out).not.toBeNull()
    const omega = out.find((r) => r.id === 'omega_3_total')
    // 0.0321 g per 100 g × 2.4 (240 g serving)
    expect(omega.amount).toBeCloseTo(0.0321 * 2.4, 6)
    expect(omega.profile).toBe('milk_grass_fed')
    expect(omega.profile_base_amount).toBe(0.05)
    // ALA had no base row → added fresh, no stash
    const ala = out.find((r) => r.id === 'ala')
    expect(ala.amount).toBeCloseTo(0.0255 * 2.4, 6)
    expect(ala.profile).toBe('milk_grass_fed')
    expect(ala.profile_base_amount).toBeUndefined()
    // untouched rows survive
    expect(out.find((r) => r.id === 'calcium').amount).toBe(300)
    expect(out.find((r) => r.name === 'Total Fat' && !r.id)).toBeTruthy()
  })

  it('restores the pristine base exactly on strip (reversible)', () => {
    const applied = applyGradeProfile(wholeMilk, 'milk_grass_fed')
    const stripped = stripGradeProfile({ ...wholeMilk, nutrients: applied })
    expect(stripped).toEqual(wholeMilk.nutrients)
  })

  it('re-applying after a switch merges over the pristine base, not the prior profile', () => {
    const once = applyGradeProfile(wholeMilk, 'milk_grass_fed')
    const twice = applyGradeProfile({ ...wholeMilk, nutrients: once }, 'milk_grass_fed')
    const omega = twice.find((r) => r.id === 'omega_3_total')
    // base still the original 0.05, not the already-overridden value
    expect(omega.profile_base_amount).toBe(0.05)
    expect(omega.amount).toBeCloseTo(0.0321 * 2.4, 6)
    // no duplicate ala rows (would double-count in day totals)
    expect(twice.filter((r) => r.id === 'ala')).toHaveLength(1)
  })

  it('strip is idempotent on a food with no profile', () => {
    expect(stripGradeProfile(wholeMilk)).toEqual(wholeMilk.nutrients)
  })

  it('returns null for Tier-1, Tier-3, and empty-override grades', () => {
    expect(applyGradeProfile(wholeMilk, 'milk_whole')).toBeNull() // Tier 1
    expect(applyGradeProfile(wholeMilk, 'organic')).toBeNull() // Tier 3
    expect(applyGradeProfile({ ...wholeMilk, name: 'eggs' }, 'egg_pasture_raised')).toBeNull() // empty overrides
  })

  it('returns null when the serving has no gram weight to scale by', () => {
    const noGrams = { ...wholeMilk, serving_desc: '1 cup' }
    expect(applyGradeProfile(noGrams, 'milk_grass_fed')).toBeNull()
  })
})

describe('nutrientsForGrade', () => {
  it('clears the profile when the grade is removed', () => {
    const applied = applyGradeProfile(wholeMilk, 'milk_grass_fed')
    const cleared = nutrientsForGrade({ ...wholeMilk, nutrients: applied }, null)
    expect(cleared).toEqual(wholeMilk.nutrients)
  })

  it('applies a Tier-2 profile from a chosen grade', () => {
    const out = nutrientsForGrade(wholeMilk, 'milk_grass_fed')
    expect(out.find((r) => r.id === 'omega_3_total').profile).toBe('milk_grass_fed')
  })

  it('returns the stripped base for a non-profile grade (stores the string only)', () => {
    const out = nutrientsForGrade(wholeMilk, 'milk_whole')
    expect(out).toEqual(wholeMilk.nutrients)
  })
})
