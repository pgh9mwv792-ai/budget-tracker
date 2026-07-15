import { addDays } from './dateHelpers'

// Day-of-week (0=Sun..6=Sat) for a plain 'YYYY-MM-DD' date, computed in UTC so
// it never shifts with the runner's local timezone.
export function dateDOW(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// Decimal wall-clock hours from start_time to end_time ('HH:MM'). Overnight
// shifts (end at or before start, e.g. 22:00→02:00) roll into the next day.
// Wall-clock — not real elapsed — hours, because hourly pay is for scheduled
// hours and shouldn't gain/lose an hour on DST-transition days.
export function shiftHours(startTime, endTime) {
  let mins = timeToMinutes(endTime) - timeToMinutes(startTime)
  if (mins <= 0) mins += 24 * 60
  return mins / 60
}

// The offset (localWallTime − UTC) in milliseconds that `timeZone` was at the
// given UTC instant. Uses Intl so it's correct across DST without any library.
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const map = {}
  for (const p of parts) map[p.type] = p.value
  let hour = Number(map.hour)
  if (hour === 24) hour = 0 // some engines format midnight as 24
  const asIfUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  )
  return asIfUTC - utcMs
}

// Convert a local wall time ('YYYY-MM-DD' + 'HH:MM') in an IANA timezone to the
// exact UTC instant it represents, correct across DST boundaries. Returns a Date.
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const wallAsUTC = Date.UTC(y, m - 1, d, hh, mm)
  // The offset depends on the instant, so guess once then settle a second time —
  // the second pass corrects readings taken on the wrong side of a transition.
  const guessOffset = tzOffsetMs(wallAsUTC, timeZone)
  let utc = wallAsUTC - guessOffset
  const settledOffset = tzOffsetMs(utc, timeZone)
  if (settledOffset !== guessOffset) utc = wallAsUTC - settledOffset
  return new Date(utc)
}

// Turn a recurring schedule_rule into concrete calendar_events rows, `weeks`
// weeks forward from `from` (default the rule's own starts_on). Pure — the API
// layer attaches user_id on insert.
//
// Options:
//   from       — 'YYYY-MM-DD' start of the window (clamped to >= rule.starts_on)
//   weeks      — how many weeks forward to generate (default 8)
//   timezone   — IANA zone the wall-clock times are in (default 'UTC')
//   hourlyRate — if known, stored per event as `amount` (hours × rate)
//   skipDates  — occurrence dates ('YYYY-MM-DD') to NOT generate, so a
//                re-materialize never clobbers a cancelled/hand-edited instance
export function materializeRule(rule, options = {}) {
  const { from, weeks = 8, timezone = 'UTC', hourlyRate = null, skipDates = [] } = options
  const days = new Set(rule.days_of_week || [])
  if (days.size === 0) return []

  const windowStart = from && from > rule.starts_on ? from : rule.starts_on
  const windowEnd = addDays(windowStart, weeks * 7 - 1) // inclusive
  const skip = new Set(skipDates)
  const rate = hourlyRate ?? rule.hourly_rate ?? null
  const overnight = timeToMinutes(rule.end_time) <= timeToMinutes(rule.start_time)
  const hours = shiftHours(rule.start_time, rule.end_time)

  const rows = []
  for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) {
    if (rule.ends_on && d > rule.ends_on) break
    if (!days.has(dateDOW(d))) continue
    if (skip.has(d)) continue

    const startsAt = zonedTimeToUtc(d, rule.start_time, timezone)
    const endsAt = zonedTimeToUtc(overnight ? addDays(d, 1) : d, rule.end_time, timezone)
    rows.push({
      rule_id: rule.id ?? null,
      income_source_id: rule.income_source_id ?? null,
      kind: rule.kind ?? 'shift',
      title: rule.title ?? (rule.kind === 'event' ? 'Event' : 'Shift'),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'confirmed',
      is_exception: false,
      amount: rate != null ? Math.round(hours * rate * 100) / 100 : null,
    })
  }
  return rows
}
