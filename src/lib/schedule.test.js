import { describe, it, expect } from 'vitest'
import { normalizeScheduleParse, scheduleTotals, buildScheduleEventRows } from './schedule'

const TODAY = '2026-07-14' // a Tuesday

describe('normalizeScheduleParse', () => {
  it('keeps valid shifts, pads times, and sorts by date then start', () => {
    const raw = {
      shifts: [
        { date: '2026-07-16', start_time: '9:00', end_time: '17:30', title: 'Cashier' },
        { date: '2026-07-15', start_time: '15:00', end_time: '21:30' },
      ],
      recurring: true,
      employer: '  Target  ',
    }
    const out = normalizeScheduleParse(raw, { today: TODAY })
    expect(out.shifts).toEqual([
      { date: '2026-07-15', start_time: '15:00', end_time: '21:30', title: null, low_confidence: false },
      { date: '2026-07-16', start_time: '09:00', end_time: '17:30', title: 'Cashier', low_confidence: false },
    ])
    expect(out.employer).toBe('Target')
    expect(out.error).toBeNull()
  })

  it('derives the weekly day-of-week pattern from the shift dates', () => {
    // Jul 15 = Wed(3), Jul 16 = Thu(4), Jul 17 = Fri(5)
    const raw = {
      shifts: [
        { date: '2026-07-17', start_time: '15:00', end_time: '21:00' },
        { date: '2026-07-15', start_time: '15:00', end_time: '21:00' },
        { date: '2026-07-16', start_time: '15:00', end_time: '21:00' },
      ],
      recurring: true,
    }
    const out = normalizeScheduleParse(raw, { today: TODAY })
    expect(out.days_of_week).toEqual([3, 4, 5])
    expect(out.recurring).toBe(true)
  })

  it('drops past-dated and malformed shifts', () => {
    const raw = {
      shifts: [
        { date: '2026-07-10', start_time: '15:00', end_time: '21:00' }, // past → dropped
        { date: '2026-07-16', start_time: '25:00', end_time: '21:00' }, // bad hour → dropped
        { date: 'not-a-date', start_time: '15:00', end_time: '21:00' }, // bad date → dropped
        { date: '2026-07-16', start_time: '15:00', end_time: '21:00' }, // kept
      ],
    }
    const out = normalizeScheduleParse(raw, { today: TODAY })
    expect(out.shifts).toEqual([
      { date: '2026-07-16', start_time: '15:00', end_time: '21:00', title: null, low_confidence: false },
    ])
  })

  it('dedupes identical shifts', () => {
    const raw = {
      shifts: [
        { date: '2026-07-16', start_time: '15:00', end_time: '21:00' },
        { date: '2026-07-16', start_time: '15:00', end_time: '21:00' },
      ],
    }
    const out = normalizeScheduleParse(raw, { today: TODAY })
    expect(out.shifts).toHaveLength(1)
  })

  it('does not mark a single shift recurring even if the model says so', () => {
    const raw = {
      shifts: [{ date: '2026-07-16', start_time: '15:00', end_time: '21:00' }],
      recurring: true,
    }
    const out = normalizeScheduleParse(raw, { today: TODAY })
    expect(out.recurring).toBe(false)
  })

  it('passes through the error when the model reports one', () => {
    const out = normalizeScheduleParse({ error: 'That photo is not a schedule.' }, { today: TODAY })
    expect(out.error).toBe('That photo is not a schedule.')
    expect(out.shifts).toEqual([])
  })

  it('surfaces clarifying questions and no error when only questions come back', () => {
    const out = normalizeScheduleParse(
      { shifts: [], questions: ['What time do you close on Friday?'] },
      { today: TODAY }
    )
    expect(out.questions).toEqual(['What time do you close on Friday?'])
    expect(out.error).toBeNull()
  })

  it('reports no_shifts when nothing usable comes back', () => {
    const out = normalizeScheduleParse({ shifts: [] }, { today: TODAY })
    expect(out.error).toBe('no_shifts')
  })

  it('handles a non-object reply defensively', () => {
    expect(normalizeScheduleParse(null).error).toBe('unreadable')
    expect(normalizeScheduleParse('nope').error).toBe('unreadable')
  })
})

describe('buildScheduleEventRows', () => {
  it('builds one event per date for a one-time draft', () => {
    const draft = {
      recurring: false,
      days_of_week: [],
      shifts: [
        { date: '2026-07-16', start_time: '15:00', end_time: '21:30' },
        { date: '2026-07-18', start_time: '10:00', end_time: '18:00' },
      ],
    }
    const rows = buildScheduleEventRows(draft, { today: TODAY, timezone: 'UTC', hourlyRate: 20 })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'shift',
      rule_id: null,
      starts_at: '2026-07-16T15:00:00.000Z',
      ends_at: '2026-07-16T21:30:00.000Z',
      amount: 130, // 6.5h × $20
      status: 'confirmed',
    })
    expect(rows[1].amount).toBe(160) // 8h × $20
  })

  it('rolls an overnight one-time shift end into the next day', () => {
    const draft = {
      recurring: false,
      days_of_week: [],
      shifts: [{ date: '2026-07-16', start_time: '22:00', end_time: '02:00' }],
    }
    const [row] = buildScheduleEventRows(draft, { today: TODAY, timezone: 'UTC', hourlyRate: null })
    expect(row.starts_at).toBe('2026-07-16T22:00:00.000Z')
    expect(row.ends_at).toBe('2026-07-17T02:00:00.000Z')
    expect(row.amount).toBeNull()
  })

  it('materializes a recurring draft across the window and stamps ids', () => {
    // Jul 15/16/17 2026 = Wed/Thu/Fri → days [3,4,5]
    const draft = {
      recurring: true,
      days_of_week: [3, 4, 5],
      shifts: [
        { date: '2026-07-15', start_time: '15:00', end_time: '21:00' },
        { date: '2026-07-16', start_time: '15:00', end_time: '21:00' },
        { date: '2026-07-17', start_time: '15:00', end_time: '21:00' },
      ],
    }
    const rows = buildScheduleEventRows(draft, {
      today: TODAY,
      weeks: 2,
      timezone: 'UTC',
      hourlyRate: 15,
      ids: { ruleId: 'rule-1', incomeSourceId: 'src-1' },
    })
    // 2 weeks × 3 days = 6 events
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.rule_id === 'rule-1' && r.income_source_id === 'src-1')).toBe(true)
    expect(rows.every((r) => r.amount === 90)).toBe(true) // 6h × $15
  })

  it('returns nothing for an empty draft', () => {
    expect(buildScheduleEventRows({ shifts: [] }, { today: TODAY })).toEqual([])
  })
})

describe('scheduleTotals', () => {
  it('sums wall-clock hours and computes gross when a rate is known', () => {
    const shifts = [
      { date: '2026-07-16', start_time: '15:00', end_time: '21:30' }, // 6.5h
      { date: '2026-07-17', start_time: '09:00', end_time: '17:00' }, // 8h
    ]
    const { hours, gross } = scheduleTotals(shifts, 15)
    expect(hours).toBe(14.5)
    expect(gross).toBe(217.5)
  })

  it('handles an overnight shift and a null rate', () => {
    const shifts = [{ date: '2026-07-16', start_time: '22:00', end_time: '02:00' }] // 4h
    const { hours, gross } = scheduleTotals(shifts)
    expect(hours).toBe(4)
    expect(gross).toBeNull()
  })
})
