import { describe, it, expect } from 'vitest'
import { foodMatchesQuery, resolveLibraryFood } from './foodResolve'

const foods = [
  { id: 1, name: "Eggland's Best Large Eggs", aliases: ['eggs'] },
  { id: 2, name: 'Rolled Oats', aliases: ['oats', 'oatmeal'] },
  { id: 3, name: 'Backyard Eggs', aliases: ['eggs'] }, // shares the "eggs" alias
  { id: 4, name: 'Greek Yogurt', aliases: [] },
]

describe('foodMatchesQuery', () => {
  it('matches on name substring', () => {
    expect(foodMatchesQuery(foods[3], 'yogurt')).toBe(true)
  })
  it('matches on an alias', () => {
    expect(foodMatchesQuery(foods[1], 'oatmeal')).toBe(true)
  })
  it('is case-insensitive and rejects blanks', () => {
    expect(foodMatchesQuery(foods[0], 'EGGS')).toBe(true)
    expect(foodMatchesQuery(foods[0], '   ')).toBe(false)
  })
})

describe('resolveLibraryFood', () => {
  it('resolves a unique alias', () => {
    const r = resolveLibraryFood(foods, 'oats')
    expect(r.via).toBe('alias')
    expect(r.match?.id).toBe(2)
    expect(r.ambiguous).toBeNull()
  })

  it('flags an ambiguous alias shared by several foods', () => {
    const r = resolveLibraryFood(foods, 'eggs')
    expect(r.match).toBeNull()
    expect(r.ambiguous?.map((f) => f.id)).toEqual([1, 3])
  })

  it('falls back to an exact name match', () => {
    const r = resolveLibraryFood(foods, 'greek yogurt')
    expect(r.via).toBe('name')
    expect(r.match?.id).toBe(4)
  })

  it('returns no match when nothing lines up', () => {
    const r = resolveLibraryFood(foods, 'ribeye')
    expect(r.match).toBeNull()
    expect(r.ambiguous).toBeNull()
  })
})
