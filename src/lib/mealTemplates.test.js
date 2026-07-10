import { describe, it, expect } from 'vitest'
import {
  weekdayOf,
  templateTotals,
  itemsFromLogs,
  resolveTemplateByName,
  plannedTemplatesForDate,
} from './mealTemplates'

// 2026-07-06 is a Monday (weekday 1); 2026-07-05 is a Sunday (0).
describe('weekdayOf', () => {
  it('maps ISO dates to 0=Sun … 6=Sat, timezone-safe', () => {
    expect(weekdayOf('2026-07-05')).toBe(0)
    expect(weekdayOf('2026-07-06')).toBe(1)
    expect(weekdayOf('2026-07-11')).toBe(6)
  })
})

const usualBreakfast = {
  id: 'tmpl-bfast',
  name: 'My usual breakfast',
  meal: 'breakfast',
  items: [
    { food_id: 'f-eggs', name: 'Eggs', servings: 2, calories: 78, protein: 6, carbs: 0.6, fat: 5, cost: 0.3 },
    { food_id: 'f-oats', name: 'Oats', servings: 1, calories: 150, protein: 5, carbs: 27, fat: 3, cost: 0.25 },
  ],
  scheduled_days: [1, 2, 3, 4, 5], // weekdays
  auto_log: false,
}

describe('templateTotals', () => {
  it('multiplies each item by its servings', () => {
    const t = templateTotals(usualBreakfast.items)
    // Eggs ×2 + Oats ×1
    expect(t.calories).toBeCloseTo(78 * 2 + 150, 2)
    expect(t.protein).toBeCloseTo(6 * 2 + 5, 2)
    expect(t.cost).toBeCloseTo(0.3 * 2 + 0.25, 2)
  })

  it('treats a null cost as zero', () => {
    const t = templateTotals([{ servings: 1, calories: 100, protein: 10, cost: null }])
    expect(t.cost).toBe(0)
    expect(t.calories).toBe(100)
  })
})

describe('itemsFromLogs', () => {
  it('snapshots each log into a self-contained item, preserving per-serving numbers', () => {
    const items = itemsFromLogs([
      { food_id: 'f-eggs', name: 'Eggs', servings: 2, calories: 78, protein: 6, carbs: 0.6, fat: 5, cost: 0.3 },
      { foodId: 'f-oats', name: 'Oats', servings: 1, calories: 150, protein: 5, carbs: 27, fat: 3, cost: null },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ food_id: 'f-eggs', servings: 2, calories: 78 })
    // Accepts either food_id or foodId on the source log.
    expect(items[1].food_id).toBe('f-oats')
    expect(items[1].cost).toBeNull()
  })
})

describe('resolveTemplateByName', () => {
  const templates = [usualBreakfast, { id: 'tmpl-lunch', name: 'Chicken lunch', items: [], scheduled_days: [] }]

  it('resolves despite filler words ("my", "usual")', () => {
    const { match } = resolveTemplateByName(templates, 'breakfast')
    expect(match?.id).toBe('tmpl-bfast')
  })

  it('resolves a full spoken phrase to the template', () => {
    const { match } = resolveTemplateByName(templates, 'my usual breakfast')
    expect(match?.id).toBe('tmpl-bfast')
  })

  it('returns no match and empty candidates when nothing is close', () => {
    const { match, candidates } = resolveTemplateByName(templates, 'dinner feast')
    expect(match).toBeNull()
    expect(candidates).toHaveLength(0)
  })

  it('reports multiple candidates instead of guessing', () => {
    const two = [
      { id: 'a', name: 'Weekday breakfast', items: [], scheduled_days: [] },
      { id: 'b', name: 'Weekend breakfast', items: [], scheduled_days: [] },
    ]
    const { match, candidates } = resolveTemplateByName(two, 'breakfast')
    expect(match).toBeNull()
    expect(candidates.map((c) => c.id).sort()).toEqual(['a', 'b'])
  })
})

describe('plannedTemplatesForDate', () => {
  const MON = '2026-07-06'
  const SUN = '2026-07-05'

  it('surfaces a template scheduled on that weekday, unlogged', () => {
    const planned = plannedTemplatesForDate([usualBreakfast], [], MON)
    expect(planned).toHaveLength(1)
    expect(planned[0].alreadyLogged).toBe(false)
    expect(planned[0].autoLog).toBe(false)
  })

  it('does not surface a template on a day it is not scheduled', () => {
    expect(plannedTemplatesForDate([usualBreakfast], [], SUN)).toHaveLength(0)
  })

  it('marks a template already logged when a log on that date carries its id', () => {
    const logs = [{ date: MON, template_id: 'tmpl-bfast', name: 'Eggs' }]
    const planned = plannedTemplatesForDate([usualBreakfast], logs, MON)
    expect(planned[0].alreadyLogged).toBe(true)
  })

  it('a log with the id on a DIFFERENT date does not count as logged today', () => {
    const logs = [{ date: SUN, template_id: 'tmpl-bfast', name: 'Eggs' }]
    const planned = plannedTemplatesForDate([usualBreakfast], logs, MON)
    expect(planned[0].alreadyLogged).toBe(false)
  })
})
