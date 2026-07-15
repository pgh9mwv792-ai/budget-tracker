import { addDays, todayISO } from './dateHelpers'
import { detectRecurring, analyzeRecurring } from './analysis'
import { cleanMerchantName } from './merchantName'

// Adds n calendar months to a 'YYYY-MM-DD' string, clamping the day to the end
// of the target month (Jan 31 + 1mo → Feb 28/29). Keeps monthly/quarterly bills
// on a stable day-of-month instead of drifting the way a fixed 30-day step does.
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + n, 1))
  const daysInTarget = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(d, daysInTarget)
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${base.getUTCFullYear()}-${mm}-${dd}`
}

const STEP_DAYS = { weekly: 7, 'every 2 weeks': 14 }
const STEP_MONTHS = { monthly: 1, quarterly: 3, annual: 12 }

function advance(dateStr, cadence) {
  if (STEP_DAYS[cadence]) return addDays(dateStr, STEP_DAYS[cadence])
  if (STEP_MONTHS[cadence]) return addMonths(dateStr, STEP_MONTHS[cadence])
  return null // unknown/irregular cadence: no projection beyond nextDate
}

// Projects a single recurring item's occurrences (dates) that fall inside
// [rangeStart, rangeEnd], stepping by its cadence from its first expected date.
// Bounded so an unexpected cadence can never loop forever.
export function occurrencesBetween(item, rangeStart, rangeEnd) {
  const dates = []
  let d = item.nextDate
  // Walk forward to the visible window if the next expected date is in the past.
  let guard = 0
  while (d < rangeStart && guard++ < 500) {
    const next = advance(d, item.cadence)
    if (!next) return dates.filter((x) => x >= rangeStart && x <= rangeEnd)
    d = next
  }
  guard = 0
  while (d <= rangeEnd && guard++ < 500) {
    if (d >= rangeStart) dates.push(d)
    const next = advance(d, item.cadence)
    if (!next) break
    d = next
  }
  return dates
}

function project(transactions, wantKind, markerKind, { today, rangeStart, rangeEnd }) {
  const recurring = detectRecurring(transactions, { today }).filter((r) => r.kind === wantKind)
  const markers = []
  for (const r of recurring) {
    for (const date of occurrencesBetween(r, rangeStart, rangeEnd)) {
      markers.push({
        kind: markerKind,
        title: cleanMerchantName(r.label),
        date,
        amount: Math.round(Number(r.amount) * 100) / 100,
        cadence: r.cadence,
        external_id: r.key,
      })
    }
  }
  return markers.sort((a, b) => (a.date < b.date ? -1 : 1))
}

// Upcoming bills as day-keyed markers over the window. Uses the SAME strict
// detector as the Transactions tab's "Recurring & subscriptions" section
// (analyzeRecurring) — so a couple of coincidental repeat purchases (two Qdoba
// runs) never become a projected bill, and per-merchant overrides
// (confirmed / "not recurring") are honored. Missed/likely-cancelled charges are
// left off. If nothing qualifies, returns [].
export function getUpcomingBills(
  transactions = [],
  { today = todayISO(), rangeStart = today, rangeEnd = addDays(today, 56), overrides = new Map() } = {}
) {
  const groups = analyzeRecurring(transactions, { today, overrides }).filter((g) => g.status !== 'missed')
  const markers = []
  for (const g of groups) {
    for (const date of occurrencesBetween({ nextDate: g.nextDate, cadence: g.cadence }, rangeStart, rangeEnd)) {
      markers.push({
        kind: 'bill',
        title: g.nickname || cleanMerchantName(g.rawLabel || g.label),
        date,
        amount: Math.round(Number(g.amount) * 100) / 100,
        cadence: g.cadence,
        external_id: g.key,
      })
    }
  }
  return markers.sort((a, b) => (a.date < b.date ? -1 : 1))
}

// Projected paydays (recurring income) as day-keyed markers over the window.
export function getProjectedPaydays(
  transactions = [],
  { today = todayISO(), rangeStart = today, rangeEnd = addDays(today, 56) } = {}
) {
  return project(transactions, 'income', 'payday', { today, rangeStart, rangeEnd })
}
