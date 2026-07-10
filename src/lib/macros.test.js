import { describe, it, expect } from 'vitest'
import { macroContributors } from './macros'

const foodsById = new Map([
  ['chicken', { id: 'chicken', name: 'Chicken breast', source: 'usda' }],
  ['shake', { id: 'shake', name: 'Chain shake', source: 'estimate' }],
])

describe('macroContributors', () => {
  it('ranks foods by their contribution to a macro, respecting servings', () => {
    const logs = [
      { id: 1, food_id: 'chicken', name: 'Chicken breast', protein: 30, servings: 2 }, // 60
      { id: 2, food_id: 'shake', name: 'Chain shake', protein: 20, servings: 1 }, // 20
    ]
    const { total, contributors } = macroContributors('protein', logs, foodsById)
    expect(total).toBe(80)
    expect(contributors.map((c) => c.name)).toEqual(['Chicken breast', 'Chain shake'])
    expect(contributors[0].pct).toBeCloseTo(75, 5)
    expect(contributors[1].pct).toBeCloseTo(25, 5)
  })

  it('aggregates the same food logged multiple times', () => {
    const logs = [
      { id: 1, food_id: 'chicken', name: 'Chicken breast', protein: 30, servings: 1 },
      { id: 2, food_id: 'chicken', name: 'Chicken breast', protein: 30, servings: 1 },
    ]
    const { contributors } = macroContributors('protein', logs, foodsById)
    expect(contributors).toHaveLength(1)
    expect(contributors[0].amount).toBe(60)
  })

  it('flags an estimate food and omits zero-contribution logs', () => {
    const logs = [
      { id: 1, food_id: 'shake', name: 'Chain shake', protein: 20, servings: 1 },
      { id: 2, food_id: 'chicken', name: 'Chicken breast', protein: 0, servings: 1 },
    ]
    const { contributors } = macroContributors('protein', logs, foodsById)
    expect(contributors).toHaveLength(1)
    expect(contributors[0].markers.estimate).toBe(true)
  })
})
