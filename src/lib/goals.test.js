import { describe, it, expect } from 'vitest'
import {
  getPace,
  getStatus,
  getProgressPct,
  rollingAverage,
  formatWeight,
  parseWeightInput,
} from './goals'

const TODAY = '2026-07-16'

// Build a run of daily {date, value} points ending at `end`, changing by
// `perDay` each day, starting from `startValue`. Useful for pace fits.
function series(end, count, startValue, perDay) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(`${end}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().slice(0, 10)
    out.push({ date, value: startValue + (count - 1 - i) * perDay })
  }
  return out
}

describe('getPace', () => {
  it('fits an increasing trend and projects the completion date', () => {
    // Weight-gain goal: gaining ~0.1 kg/day, target 80 from a 78 start.
    const goal = { direction: 'increase', target_value: 80 }
    const history = series(TODAY, 20, 78, 0.1) // 78.0 → 79.9 over 20 days
    const pace = getPace(goal, history, { today: TODAY })
    expect(pace.insufficient).toBe(false)
    expect(pace.ratePerDay).toBeCloseTo(0.1, 4)
    expect(pace.ratePerWeek).toBeCloseTo(0.7, 4)
    // At +0.1/day from 79.9 today, 80 is reached ~1 day out — a future date.
    expect(pace.projectedDate).not.toBeNull()
    expect(pace.projectedDate >= TODAY).toBe(true)
  })

  it('returns no projection for empty history', () => {
    const goal = { direction: 'increase', target_value: 80 }
    const pace = getPace(goal, [], { today: TODAY })
    expect(pace.insufficient).toBe(true)
    expect(pace.projectedDate).toBeNull()
    expect(pace.ratePerDay).toBeNull()
  })

  it('returns no projection for a single data point', () => {
    const goal = { direction: 'increase', target_value: 80 }
    const pace = getPace(goal, [{ date: TODAY, value: 79 }], { today: TODAY })
    expect(pace.insufficient).toBe(true)
    expect(pace.projectedDate).toBeNull()
  })

  it('does not project a date when the trend moves away from the target', () => {
    // Losing weight but the goal is to GAIN to 80 — no forward projection.
    const goal = { direction: 'increase', target_value: 80 }
    const history = series(TODAY, 10, 79, -0.2)
    const pace = getPace(goal, history, { today: TODAY })
    expect(pace.insufficient).toBe(false)
    expect(pace.ratePerDay).toBeLessThan(0)
    expect(pace.projectedDate).toBeNull()
  })
})

describe('getStatus — normal goals', () => {
  it('is on_pace for an increase goal trending in on time', () => {
    const goal = { direction: 'increase', target_value: 3000, deadline: '2026-12-31' }
    const pace = { ratePerDay: 20, ratePerWeek: 140, projectedDate: '2026-11-02', insufficient: false }
    expect(getStatus(goal, 1840, pace, { today: TODAY })).toBe('on_pace')
  })

  it('is behind when the projection lands after the deadline', () => {
    const goal = { direction: 'increase', target_value: 3000, deadline: '2026-09-30' }
    const pace = { ratePerDay: 20, ratePerWeek: 140, projectedDate: '2026-11-02', insufficient: false }
    expect(getStatus(goal, 1840, pace, { today: TODAY })).toBe('behind')
  })

  it('is done once the target is reached', () => {
    const goal = { direction: 'increase', target_value: 3000, deadline: '2026-12-31' }
    const pace = { ratePerDay: 20, projectedDate: null, insufficient: false }
    expect(getStatus(goal, 3000, pace, { today: TODAY })).toBe('done')
  })

  it('does not cry wolf with no deadline or no projection', () => {
    const goal = { direction: 'increase', target_value: 3000 }
    const pace = { ratePerDay: null, projectedDate: null, insufficient: true }
    expect(getStatus(goal, 500, pace, { today: TODAY })).toBe('on_pace')
  })
})

describe('getStatus — spend-limit goals (projected overspend, not raw percent)', () => {
  const goal = {
    type: 'financial',
    direction: 'decrease',
    target_value: 400,
    source_ref: { kind: 'budget_category', id: 'cat-food' },
  }
  // ~$17.67/day pace (e.g. $318 over the first ~18 days of the month).
  const pace = { ratePerDay: 17.67, ratePerWeek: 123.7, projectedDate: null, insufficient: false }

  it('is behind: $318 of $400 with 12 days left projects to overspend', () => {
    expect(getStatus(goal, 318, pace, { today: TODAY, periodDaysRemaining: 12 })).toBe('behind')
  })

  it('is on pace: the same $318 with 2 days left will not breach the limit', () => {
    expect(getStatus(goal, 318, pace, { today: TODAY, periodDaysRemaining: 2 })).toBe('on_pace')
  })

  it('flags an already-over-limit spend even without a trend', () => {
    const noPace = { ratePerDay: null, projectedDate: null, insufficient: true }
    expect(getStatus(goal, 420, noPace, { today: TODAY, periodDaysRemaining: 5 })).toBe('behind')
    expect(getStatus(goal, 380, noPace, { today: TODAY, periodDaysRemaining: 5 })).toBe('on_pace')
  })
})

describe('getProgressPct', () => {
  it('increase: fraction of the gain achieved', () => {
    const goal = { direction: 'increase', start_value: 0, target_value: 3000 }
    expect(getProgressPct(goal, 1500)).toBeCloseTo(50, 5)
  })

  it('decrease (debt): fraction paid down from start to target', () => {
    const goal = { direction: 'decrease', start_value: 5000, target_value: 0 }
    expect(getProgressPct(goal, 2000)).toBeCloseTo(60, 5)
  })

  it('spend-limit: bar shows fraction of the limit used', () => {
    const goal = {
      type: 'financial',
      direction: 'decrease',
      target_value: 400,
      source_ref: { kind: 'budget_category', id: 'c' },
    }
    expect(getProgressPct(goal, 318)).toBeCloseTo(79.5, 5)
  })

  it('clamps beyond 100', () => {
    const goal = { direction: 'increase', start_value: 0, target_value: 100 }
    expect(getProgressPct(goal, 250)).toBe(100)
  })
})

describe('rollingAverage', () => {
  it('averages the trailing 7 days, not the latest raw entry', () => {
    const logs = [
      { logged_on: '2026-07-16', weight_kg: 80 },
      { logged_on: '2026-07-15', weight_kg: 82 },
      { logged_on: '2026-07-14', weight_kg: 81 },
    ]
    expect(rollingAverage(logs, { asOf: TODAY })).toBeCloseTo(81, 5)
  })

  it('falls back to the most recent entry when none are in the window', () => {
    const logs = [{ logged_on: '2026-06-01', weight_kg: 90 }]
    expect(rollingAverage(logs, { asOf: TODAY })).toBe(90)
  })

  it('returns null for no logs', () => {
    expect(rollingAverage([], { asOf: TODAY })).toBeNull()
  })
})

describe('weight formatting', () => {
  it('formats kg to the chosen unit at one decimal', () => {
    expect(formatWeight(80, 'metric')).toBe('80.0 kg')
    expect(formatWeight(80, 'imperial')).toBe('176.4 lb')
    expect(formatWeight(80, 'imperial', { withUnit: false })).toBe('176.4')
  })

  it('parses user input back to kilograms', () => {
    expect(parseWeightInput('80', 'metric')).toBeCloseTo(80, 5)
    expect(parseWeightInput('176.37', 'imperial')).toBeCloseTo(80, 2)
    expect(parseWeightInput('', 'metric')).toBeNull()
    expect(parseWeightInput('-5', 'metric')).toBeNull()
  })
})
