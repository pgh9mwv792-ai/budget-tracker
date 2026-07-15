import { describe, it, expect } from 'vitest'
import { occurrencesBetween, getUpcomingBills, getProjectedPaydays } from './calendarSources'

describe('occurrencesBetween', () => {
  it('projects a weekly item across the window', () => {
    const item = { nextDate: '2026-07-15', cadence: 'weekly' }
    expect(occurrencesBetween(item, '2026-07-14', '2026-08-05')).toEqual([
      '2026-07-15',
      '2026-07-22',
      '2026-07-29',
      '2026-08-05',
    ])
  })

  it('keeps monthly items on a stable day-of-month instead of drifting', () => {
    const item = { nextDate: '2026-07-31', cadence: 'monthly' }
    // Aug has 30... no, Aug has 31; Sep has 30 → clamps to Sep 30.
    expect(occurrencesBetween(item, '2026-07-01', '2026-09-30')).toEqual([
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ])
  })

  it('advances a past nextDate forward into the visible window', () => {
    const item = { nextDate: '2026-06-01', cadence: 'monthly' }
    expect(occurrencesBetween(item, '2026-07-14', '2026-08-31')).toEqual(['2026-08-01'])
  })

  it('returns just the single nextDate for an irregular cadence in range', () => {
    const item = { nextDate: '2026-07-20', cadence: 'irregular' }
    expect(occurrencesBetween(item, '2026-07-14', '2026-08-31')).toEqual(['2026-07-20'])
  })
})

describe('getUpcomingBills / getProjectedPaydays', () => {
  // Two months of a monthly rent expense + a biweekly paycheck.
  const transactions = [
    { note: 'Rent', kind: 'expense', amount: 1400, date: '2026-05-01' },
    { note: 'Rent', kind: 'expense', amount: 1400, date: '2026-06-01' },
    { note: 'Rent', kind: 'expense', amount: 1400, date: '2026-07-01' },
    { note: 'ACME PAYROLL', kind: 'income', amount: 1200, date: '2026-06-19' },
    { note: 'ACME PAYROLL', kind: 'income', amount: 1200, date: '2026-07-03' },
  ]

  it('surfaces upcoming bills as day-keyed markers with amounts', () => {
    const bills = getUpcomingBills(transactions, {
      today: '2026-07-14',
      rangeStart: '2026-07-14',
      rangeEnd: '2026-09-30',
    })
    expect(bills.every((b) => b.kind === 'bill')).toBe(true)
    expect(bills.map((b) => b.date)).toContain('2026-08-01')
    expect(bills[0].amount).toBe(1400)
  })

  it('projects paydays forward from the detected biweekly cadence', () => {
    const paydays = getProjectedPaydays(transactions, {
      today: '2026-07-14',
      rangeStart: '2026-07-14',
      rangeEnd: '2026-08-15',
    })
    expect(paydays.every((p) => p.kind === 'payday')).toBe(true)
    // From 2026-07-03 + 14-day steps: 07-17, 07-31, 08-14 land in-window.
    expect(paydays.map((p) => p.date)).toEqual(['2026-07-17', '2026-07-31', '2026-08-14'])
  })
})
