import { describe, it, expect } from 'vitest'
import { materializeRule, zonedTimeToUtc, shiftHours, dateDOW } from './materialize'

// A weekly shift rule with sensible defaults; override per case.
function rule(over = {}) {
  return {
    id: 'rule_1',
    income_source_id: 'src_1',
    kind: 'shift',
    title: 'Shift',
    days_of_week: [2, 4], // Tue, Thu
    start_time: '15:00',
    end_time: '21:30',
    starts_on: '2026-07-14', // a Tuesday
    ends_on: null,
    ...over,
  }
}

describe('shiftHours', () => {
  it('computes decimal hours for a same-day shift', () => {
    expect(shiftHours('15:00', '21:30')).toBe(6.5)
  })
  it('rolls an overnight (closing) shift into the next day', () => {
    expect(shiftHours('22:00', '02:00')).toBe(4)
  })
})

describe('materializeRule — weekly recurrence', () => {
  it('generates one instance per matching weekday for the whole window', () => {
    const rows = materializeRule(rule(), { weeks: 8, timezone: 'America/New_York' })
    // 8 weeks × 2 days a week = 16 instances.
    expect(rows).toHaveLength(16)
    // Every instance lands on a scheduled weekday.
    for (const r of rows) {
      const localDate = r.starts_at.slice(0, 10) // close enough for DOW here
      expect([2, 4]).toContain(dateDOW(localDate))
    }
    // All carry the rule + source linkage and default status.
    expect(rows[0].rule_id).toBe('rule_1')
    expect(rows[0].income_source_id).toBe('src_1')
    expect(rows[0].status).toBe('confirmed')
    expect(rows[0].is_exception).toBe(false)
  })

  it('stores computed gross when an hourly rate is known', () => {
    const rows = materializeRule(rule(), { weeks: 1, timezone: 'UTC', hourlyRate: 15 })
    // 6.5 hr × $15 = $97.50 per shift.
    expect(rows[0].amount).toBe(97.5)
  })

  it('leaves amount null when no rate is known', () => {
    const rows = materializeRule(rule(), { weeks: 1, timezone: 'UTC' })
    expect(rows[0].amount).toBeNull()
  })

  it('respects ends_on by truncating the series', () => {
    // Only the first week: Tue Jul 14 and Thu Jul 16.
    const rows = materializeRule(rule({ ends_on: '2026-07-16' }), {
      weeks: 8,
      timezone: 'UTC',
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.starts_at.slice(0, 10))).toEqual(['2026-07-14', '2026-07-16'])
  })

  it('clamps the window to `from` when it is after starts_on', () => {
    const rows = materializeRule(rule(), { from: '2026-07-21', weeks: 1, timezone: 'UTC' })
    // Window starts Jul 21 (Tue); first week yields Tue Jul 21 + Thu Jul 23.
    expect(rows.map((r) => r.starts_at.slice(0, 10))).toEqual(['2026-07-21', '2026-07-23'])
  })
})

describe('materializeRule — exceptions', () => {
  it('skips occurrence dates already handled, so a re-materialize never clobbers a hand-edited or cancelled instance', () => {
    const rows = materializeRule(rule({ ends_on: '2026-07-16' }), {
      weeks: 8,
      timezone: 'UTC',
      skipDates: ['2026-07-16'], // Thursday was cancelled / edited off the rule
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].starts_at.slice(0, 10)).toBe('2026-07-14')
  })
})

describe('zonedTimeToUtc — DST boundary', () => {
  it('maps 3pm local to the correct UTC instant on both sides of a DST change', () => {
    // America/New_York is EST (UTC−5) in January, EDT (UTC−4) in July.
    expect(zonedTimeToUtc('2026-01-15', '15:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T20:00:00.000Z'
    )
    expect(zonedTimeToUtc('2026-07-15', '15:00', 'America/New_York').toISOString()).toBe(
      '2026-07-15T19:00:00.000Z'
    )
  })

  it('keeps the same wall-clock time across a spring-forward boundary in one series', () => {
    // DST springs forward on 2026-03-08 in the US. A Sunday 15:00 rule should
    // stay 15:00 local before and after — i.e. its UTC hour shifts by one.
    const rows = materializeRule(
      rule({ days_of_week: [0], start_time: '15:00', end_time: '18:00', starts_on: '2026-03-01' }),
      { weeks: 3, timezone: 'America/New_York' }
    )
    const before = rows.find((r) => r.starts_at.startsWith('2026-03-01')) // EST
    const after = rows.find((r) => r.starts_at.startsWith('2026-03-15')) // EDT
    expect(before.starts_at).toBe('2026-03-01T20:00:00.000Z') // 15:00 −05:00
    expect(after.starts_at).toBe('2026-03-15T19:00:00.000Z') // 15:00 −04:00
  })
})
