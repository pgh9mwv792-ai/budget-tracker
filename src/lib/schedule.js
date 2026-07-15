import { todayISO } from './dateHelpers'
import { dateDOW, shiftHours, zonedTimeToUtc, materializeRule } from './materialize'
import { callVision, fileToContentBlock, parseJson } from './receipt'

// Parses a work schedule from plain English and/or a screenshot into a set of
// concrete shifts the confirmation card can show and (on confirm) turn into a
// schedule_rule + calendar_events. Reuses the same secure `chat` proxy, daily
// cap, and defensive JSON handling as the receipt scanner — Anthropic is only
// ever reached through the `chat` edge function.

// The browser's IANA timezone (e.g. 'America/New_York'). The parser needs it to
// resolve "tonight" / "this Friday" and to store wall-clock times in the right
// zone later.
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// 'H:MM' or 'HH:MM' (24-hour) → zero-padded 'HH:MM', or null if out of range /
// unparseable. The model is told to emit 24-hour times; this is the guard.
function normalizeTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim())

// Turns the model's raw reply object into a validated, normalized draft:
//   {
//     shifts: [{ date, start_time, end_time, title, low_confidence }],  // sorted, valid only
//     days_of_week: [0..6],       // weekly pattern across the shift dates
//     recurring: boolean,         // model's recurrence read, gated on ≥2 shifts
//     employer: string|null,      // best-guess employer name for wage setup
//     questions: [string],        // clarifying questions to surface in the card
//     error: string|null,         // set when the input wasn't a readable schedule
//   }
// Pure and defensive: bad rows are dropped rather than thrown, so a partial read
// still yields a usable card. Exported so it can be unit-tested without the API.
export function normalizeScheduleParse(raw, { today = todayISO() } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { shifts: [], days_of_week: [], recurring: false, employer: null, questions: [], error: 'unreadable' }
  }
  if (raw.error) {
    return { shifts: [], days_of_week: [], recurring: false, employer: null, questions: [], error: String(raw.error) }
  }

  const seen = new Set()
  const shifts = (Array.isArray(raw.shifts) ? raw.shifts : [])
    .map((s) => {
      const date = isoDate(s?.date) ? s.date.trim() : null
      const start = normalizeTime(s?.start_time)
      const end = normalizeTime(s?.end_time)
      if (!date || !start || !end) return null
      // A shift in the past is almost always a mis-read of a relative date; the
      // card is for scheduling forward, so drop anything before today.
      if (date < today) return null
      return {
        date,
        start_time: start,
        end_time: end,
        title: s?.title ? String(s.title).trim() : null,
        low_confidence: s?.low_confidence === true,
      }
    })
    .filter(Boolean)
    .filter((s) => {
      const key = `${s.date}|${s.start_time}|${s.end_time}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)))

  // Weekly pattern = the distinct weekdays the shifts fall on. Useful both as the
  // rule's days_of_week and to show "repeats Tue–Fri" in the card.
  const days_of_week = [...new Set(shifts.map((s) => dateDOW(s.date)))].sort((a, b) => a - b)

  // Only call it recurring when the model says so AND there's more than one shift
  // to repeat — a single shift is a one-off no matter what the model guessed.
  const recurring = raw.recurring === true && shifts.length > 1

  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((q) => String(q ?? '').trim())
    .filter(Boolean)

  return {
    shifts,
    days_of_week,
    recurring,
    employer: raw.employer ? String(raw.employer).trim() : null,
    questions,
    error: shifts.length === 0 && questions.length === 0 ? 'no_shifts' : null,
  }
}

// Sum of wall-clock hours across a draft's shifts, and the estimated gross if an
// hourly rate is known. Used for the confirmation card's footer.
export function scheduleTotals(shifts, hourlyRate = null) {
  const hours = shifts.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0)
  const rounded = Math.round(hours * 100) / 100
  const gross = hourlyRate != null ? Math.round(rounded * hourlyRate * 100) / 100 : null
  return { hours: rounded, gross }
}

// Turn a confirmed draft into calendar_events rows ready for insert. A recurring
// draft becomes a synthetic rule materialized `weeks` forward (so it fills the
// grid like any rule); a one-time draft becomes one row per listed date. Pure —
// callers attach user_id / rule_id / income_source_id on write. When those ids
// are known up front they can be passed in `ids` to stamp every row.
export function buildScheduleEventRows(draft, options = {}) {
  const {
    today = todayISO(),
    weeks = 8,
    timezone = 'UTC',
    hourlyRate = null,
    title = 'Shift',
    ids = {},
  } = options
  const shifts = draft?.shifts ?? []
  if (shifts.length === 0) return []

  const stamp = (rows) =>
    rows.map((r) => ({
      ...r,
      title: r.title ?? title,
      rule_id: ids.ruleId ?? r.rule_id ?? null,
      income_source_id: ids.incomeSourceId ?? r.income_source_id ?? null,
    }))

  if (draft.recurring && draft.days_of_week?.length) {
    const rule = {
      id: ids.ruleId ?? null,
      income_source_id: ids.incomeSourceId ?? null,
      kind: 'shift',
      title,
      days_of_week: draft.days_of_week,
      start_time: shifts[0].start_time,
      end_time: shifts[0].end_time,
      starts_on: today,
    }
    return stamp(materializeRule(rule, { from: today, weeks, timezone, hourlyRate }))
  }

  // One-time: each shift is its own event on its own date.
  return stamp(
    shifts.map((s) => {
      const overnight = s.end_time <= s.start_time
      const startsAt = zonedTimeToUtc(s.date, s.start_time, timezone)
      const endDate = overnight ? isoNextDay(s.date) : s.date
      const endsAt = zonedTimeToUtc(endDate, s.end_time, timezone)
      const hours = shiftHours(s.start_time, s.end_time)
      return {
        rule_id: null,
        income_source_id: ids.incomeSourceId ?? null,
        kind: 'shift',
        title: s.title ?? title,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: 'confirmed',
        is_exception: false,
        amount: hourlyRate != null ? Math.round(hours * hourlyRate * 100) / 100 : null,
      }
    })
  )
}

function isoNextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}

function buildSystem({ today, timezone, userName, employerGuess, closeTime }) {
  return `You extract a work schedule from a user's message and/or a screenshot of a work-schedule grid.
The user's local date is ${today} and their timezone is ${timezone}. Resolve all relative dates ("today", "tonight", "this Friday", "next week") against that local date. NEVER return a date before ${today}.
${userName ? `The user's name is "${userName}". A schedule screenshot often lists MANY employees — return ONLY the shifts on ${userName}'s row/column. Ignore everyone else.` : 'A schedule screenshot may list several employees; if you cannot tell which row is the user, ask via "questions" rather than guessing.'}
${employerGuess ? `The employer is likely "${employerGuess}".` : ''}
${closeTime ? `This employer closes at ${closeTime} (24-hour local). When a shift ends at "close" or "closing", use ${closeTime} as the end_time — do NOT ask.` : ''}

Respond with ONLY a JSON object — no prose, no markdown code fences. Use exactly this schema:
{
  "shifts": [
    {
      "date": "YYYY-MM-DD",        // the calendar date of this shift, resolved to an absolute date
      "start_time": "HH:MM",       // 24-hour local wall-clock start (e.g. "15:00")
      "end_time": "HH:MM",         // 24-hour local wall-clock end; for a shift ending after midnight use the clock time (e.g. "02:00")
      "title": string|null,        // a role/note if shown (e.g. "Cashier"), else null
      "low_confidence": boolean    // true if the time or date was hard to read or inferred
    }
  ],
  "recurring": boolean,            // true if this is a repeating weekly pattern rather than a one-off set of dates
  "days_of_week": [0-6],           // if recurring, the weekdays it repeats on (0=Sun..6=Sat)
  "employer": string|null,         // the employer/store name if stated or visible, else null
  "questions": [string],           // short clarifying questions ONLY for real ambiguities (unknown close time, which employee, AM/PM unclear)
  "error": string|null             // a short human message if this is NOT a readable schedule; otherwise null
}

Rules — follow exactly:
1. Output absolute dates only. Convert every relative reference against ${today} in ${timezone}.
2. If a shift's end is written as "close" or is otherwise unknown, do NOT invent a time — leave that shift out of "shifts" and add a question like "What time do you close?" so the user can supply it.
3. If the user gives a weekly pattern with no explicit dates (e.g. "I work Tue–Fri 3–9:30"), set recurring:true, fill days_of_week, and emit one shift per matching date across the NEXT 7 days starting ${today}.
4. Keep questions short and only for genuine ambiguity. No questions if the schedule is clear.
5. If the input is not a schedule at all (blurry photo, unrelated text), set "error" and return an empty shifts array. Never invent shifts.`
}

// Parse a schedule from text and/or image file(s). Returns the normalized draft
// from normalizeScheduleParse(). `prior` (optional) is a previous draft +
// follow-up context so the user can revise the pending card in plain English
// (e.g. "actually Friday is 4pm not 3pm") without re-uploading.
export async function parseSchedule({
  text = '',
  files = [],
  today = todayISO(),
  timezone = localTimeZone(),
  userName = null,
  employerGuess = null,
  closeTime = null,
  prior = null,
}) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
  if (!text.trim() && list.length === 0) {
    throw new Error('Type your schedule or add a screenshot first.')
  }

  const blocks = await Promise.all(list.map((f) => fileToContentBlock(f)))
  const system = buildSystem({ today, timezone, userName, employerGuess, closeTime })

  const content = [...blocks]
  if (prior) {
    content.push({
      type: 'text',
      text: `You previously extracted this schedule:\n${JSON.stringify(prior.shifts)}\nThe user now says: "${text.trim()}"\nApply their correction and return the full updated schedule JSON.`,
    })
  } else {
    content.push({
      type: 'text',
      text: text.trim()
        ? `Extract the schedule as JSON following the schema exactly.\n\nUser's message: "${text.trim()}"`
        : 'Extract the schedule from the attached screenshot as JSON following the schema exactly.',
    })
  }

  const resp = await callVision(system, [{ role: 'user', content }], 2048)
  const replyText = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = parseJson(replyText)
  if (!parsed) throw new Error("Couldn't read that schedule. Try rephrasing, or add a clearer screenshot.")

  return normalizeScheduleParse(parsed, { today })
}
