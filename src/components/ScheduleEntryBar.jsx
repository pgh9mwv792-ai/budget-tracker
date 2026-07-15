import { useRef, useState } from 'react'
import { parseSchedule, scheduleTotals, localTimeZone } from '../lib/schedule'
import { shiftHours } from '../lib/materialize'
import { todayISO } from '../lib/dateHelpers'

// The AI entry bar for the Calendar: type your schedule in plain English OR
// upload a screenshot of a work-schedule grid, and Claude turns it into an
// editable confirmation card. Nothing is written until the user confirms — the
// card's rows are all editable/removable, ambiguities surface as questions, and
// a follow-up line lets the user revise in plain English (re-calling the parser
// with the pending draft as context).
//
// Props:
//   onCommit(draft): persist a confirmed schedule. `draft` is
//     { shifts:[{date,start_time,end_time,title,low_confidence}], recurring,
//       days_of_week, employer, rawInput }. The Calendar owns the DB writes
//       (income source + rule + materialized events) so this stays capture-only.
//   userName / hourlyRate / employerGuess: context passed to the parser and used
//     for the estimated-gross footer.
export default function ScheduleEntryBar({
  onCommit,
  userName = null,
  hourlyRate = null,
  employerGuess = null,
  closeTime = null,
  today = todayISO(),
}) {
  const uploadRef = useRef(null)
  const cameraRef = useRef(null)
  const timezone = localTimeZone()

  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle') // idle | reading | review | saving
  const [error, setError] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  const [draft, setDraft] = useState(null) // normalized parse + user edits
  const [rawInput, setRawInput] = useState('') // what we store on the rule for provenance
  const [recurring, setRecurring] = useState(false)
  const [followUp, setFollowUp] = useState('')
  // First-shift wage setup: only shown when no employer rate is known yet.
  const [wageName, setWageName] = useState('')
  const [wageRate, setWageRate] = useState('')
  const [wageClose, setWageClose] = useState('') // optional "closes at" time, saved per employer

  const reading = status === 'reading'
  const needsWage = hourlyRate == null

  const runParse = async ({ files = [], message = '', prior = null } = {}) => {
    setError(null)
    setSavedNote(null)
    setStatus('reading')
    try {
      const result = await parseSchedule({
        text: message,
        files,
        today,
        timezone,
        userName,
        employerGuess,
        closeTime: closeTime || (wageClose || null),
        prior,
      })
      if (result.error === 'no_shifts' && result.questions.length === 0) {
        setError("I couldn't find any shifts in that. Try naming the days and times.")
        setStatus('idle')
        return
      }
      if (result.error && result.error !== 'no_shifts') {
        setError(result.error)
        setStatus('idle')
        return
      }
      setDraft(result)
      setRecurring(result.recurring)
      setRawInput(files.length ? `screenshot: ${result.shifts.length} shifts` : message)
      if (needsWage && !wageName && (result.employer || employerGuess)) {
        setWageName(result.employer || employerGuess)
      }
      setStatus('review')
    } catch (err) {
      setError(err.message)
      setStatus('idle')
    }
  }

  const submitText = () => {
    if (!text.trim()) return
    runParse({ message: text.trim() })
  }

  const handleFile = (e) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    runParse({ files, message: text.trim() })
  }

  const updateShift = (idx, patch) =>
    setDraft((d) => ({ ...d, shifts: d.shifts.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }))
  const removeShift = (idx) =>
    setDraft((d) => ({ ...d, shifts: d.shifts.filter((_, i) => i !== idx) }))

  const sendFollowUp = () => {
    if (!followUp.trim() || !draft) return
    const message = followUp.trim()
    setFollowUp('')
    runParse({ message, prior: draft })
  }

  const cancel = () => {
    setDraft(null)
    setStatus('idle')
    setError(null)
    setFollowUp('')
  }

  const commit = async () => {
    if (!draft || draft.shifts.length === 0) return
    // Weekly pattern comes from whatever dates survived editing, so a removed row
    // correctly drops its weekday from a recurring rule.
    const days = [...new Set(draft.shifts.map((s) => new Date(`${s.date}T12:00:00Z`).getUTCDay()))].sort(
      (a, b) => a - b
    )
    // Only pass a wage when the user actually entered a rate on the first shift;
    // an empty rate just means "don't know yet" and shifts save without gross.
    const rate = Number(wageRate)
    const wage =
      needsWage && wageName.trim() && Number.isFinite(rate) && rate > 0
        ? { name: wageName.trim(), hourlyRate: Math.round(rate * 100) / 100, closeTime: wageClose || null }
        : null

    setStatus('saving')
    setError(null)
    try {
      await onCommit({
        shifts: draft.shifts,
        recurring,
        days_of_week: days,
        employer: draft.employer,
        rawInput: rawInput || text.trim() || null,
        wage,
      })
      setSavedNote(
        recurring
          ? `Added a repeating shift on ${days.length} day${days.length === 1 ? '' : 's'} a week.`
          : `Added ${draft.shifts.length} shift${draft.shifts.length === 1 ? '' : 's'} to your calendar.`
      )
      setDraft(null)
      setText('')
      setStatus('idle')
    } catch (err) {
      setError(err.message)
      setStatus('review')
    }
  }

  // Gross preview uses the known employer rate, or the rate being typed into the
  // wage setup, so the estimate updates live as the user fills it in.
  const typedRate = Number(wageRate)
  const effectiveRate = hourlyRate ?? (Number.isFinite(typedRate) && typedRate > 0 ? typedRate : null)
  const totals = draft ? scheduleTotals(draft.shifts, effectiveRate) : { hours: 0, gross: null }
  const liveGross = totals.gross

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <input ref={uploadRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />

      {status !== 'review' && (
        <div>
          <h3 className="text-sm font-semibold text-text">Add your work schedule</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Type it in plain English (“I work Tue–Fri 3–9:30”) or upload a screenshot of your schedule.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitText()}
              disabled={reading}
              placeholder="e.g. Work Thu & Fri 4pm to close, Sat 10–6"
              className="flex-1 rounded-md border border-border bg-surface text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive disabled:opacity-60"
            />
            <div className="flex gap-2">
              <button
                onClick={submitText}
                disabled={reading || !text.trim()}
                className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
              >
                {reading ? 'Reading…' : 'Read'}
              </button>
              <button
                onClick={() => cameraRef.current?.click()}
                disabled={reading}
                title="Take a photo of your schedule"
                aria-label="Take a photo of your schedule"
                className="sm:hidden rounded-lg border border-border text-text px-3 py-2 hover:bg-primary-tint transition disabled:opacity-60"
              >
                📷
              </button>
              <button
                onClick={() => uploadRef.current?.click()}
                disabled={reading}
                title="Upload a screenshot"
                aria-label="Upload a screenshot"
                className="rounded-lg border border-border text-text px-3 py-2 hover:bg-primary-tint transition disabled:opacity-60"
              >
                📎
              </button>
            </div>
          </div>
          {reading && <p className="mt-3 text-sm text-text-muted">Reading your schedule — a few seconds…</p>}
        </div>
      )}

      {status === 'review' && draft && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Check your shifts</h3>
            {draft.shifts.some((s) => s.low_confidence) && (
              <span className="text-xs rounded-full bg-warning/10 text-warning px-2 py-0.5">
                ⚠ Some times were hard to read
              </span>
            )}
          </div>

          {draft.questions.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">
              <p className="font-medium text-warning mb-1">A couple of things to confirm:</p>
              <ul className="list-disc pl-5 space-y-0.5 text-text-muted">
                {draft.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-text-muted">Answer below and I’ll update the shifts.</p>
            </div>
          )}

          {draft.shifts.length === 0 ? (
            <p className="text-sm text-text-muted">No shifts yet — answer the question above or describe them below.</p>
          ) : (
            <ul className="space-y-2">
              {draft.shifts.map((s, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
                >
                  {s.low_confidence && <span title="Low confidence — double-check">⚠</span>}
                  <input
                    type="date"
                    value={s.date}
                    onChange={(e) => updateShift(i, { date: e.target.value })}
                    className={cellCls}
                  />
                  <input
                    type="time"
                    value={s.start_time}
                    onChange={(e) => updateShift(i, { start_time: e.target.value })}
                    className={cellCls}
                  />
                  <span className="text-text-muted text-sm">–</span>
                  <input
                    type="time"
                    value={s.end_time}
                    onChange={(e) => updateShift(i, { end_time: e.target.value })}
                    className={cellCls}
                  />
                  <span className="text-xs text-text-muted ml-auto">
                    {shiftHours(s.start_time, s.end_time)}h
                  </span>
                  <button
                    onClick={() => removeShift(i)}
                    title="Remove this shift"
                    aria-label="Remove this shift"
                    className="text-text-muted hover:text-danger transition"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {draft.shifts.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-text">
              <span className="text-text-muted">Repeat</span>
              <select
                value={recurring ? 'weekly' : 'once'}
                onChange={(e) => setRecurring(e.target.value === 'weekly')}
                className={cellCls}
              >
                <option value="once">Just these dates</option>
                <option value="weekly">Every week on these days</option>
              </select>
            </label>
          )}

          {needsWage && draft.shifts.length > 0 && (
            <div className="rounded-lg border border-border bg-bg px-3 py-2.5 space-y-2">
              <p className="text-xs font-medium text-text">
                Set up your pay <span className="text-text-muted font-normal">(optional — powers your income estimate)</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={wageName}
                  onChange={(e) => setWageName(e.target.value)}
                  placeholder="Employer (e.g. Target)"
                  className={`flex-1 ${cellCls}`}
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted text-sm">$</span>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={wageRate}
                    onChange={(e) => setWageRate(e.target.value)}
                    placeholder="0.00"
                    className={`w-24 ${cellCls}`}
                  />
                  <span className="text-text-muted text-sm">/hr</span>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <span>Closes at</span>
                <input
                  type="time"
                  value={wageClose}
                  onChange={(e) => setWageClose(e.target.value)}
                  className={cellCls}
                />
                <span className="text-text-muted">— so “to close” fills itself in next time</span>
              </label>
            </div>
          )}

          {draft.shifts.length > 0 && (
            <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
              <span className="text-text-muted">
                {totals.hours}h total
                {recurring ? ' / week' : ''}
              </span>
              {liveGross != null && (
                <span className="text-text font-medium">
                  ≈ ${Math.round(liveGross).toLocaleString()} gross
                </span>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendFollowUp()}
              disabled={reading}
              placeholder="Something off? e.g. “Friday ends at 10, not 9”"
              className="flex-1 rounded-md border border-border bg-surface text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive disabled:opacity-60"
            />
            <button
              onClick={sendFollowUp}
              disabled={reading || !followUp.trim()}
              className="rounded-lg border border-border text-text text-sm font-medium px-4 py-2 hover:bg-primary-tint transition disabled:opacity-60"
            >
              {reading ? 'Updating…' : 'Update'}
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={commit}
              disabled={status === 'saving' || draft.shifts.length === 0}
              className="rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-medium px-4 py-2 transition disabled:opacity-60"
            >
              {status === 'saving' ? 'Adding…' : 'Add to calendar'}
            </button>
            <button
              onClick={cancel}
              className="rounded-lg border border-border text-text-muted text-sm font-medium px-4 py-2 hover:bg-primary-tint transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {savedNote && <p className="mt-3 text-sm text-success">✓ {savedNote}</p>}
      {error && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm px-3 py-2">
          {error}
        </div>
      )}
    </div>
  )
}

const cellCls =
  'rounded-md border border-border bg-surface text-text px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive'
