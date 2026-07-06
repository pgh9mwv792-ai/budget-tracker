import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { useIsMobile } from '../lib/useMediaQuery'

// Common places people can see their score for free — used to prefill the
// "where did this come from" dropdown so entry is one tap.
const SOURCES = ['Credit Karma', 'My bank app', 'My credit card app', 'Experian', 'Other']

const fmt = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function scoreBand(score) {
  if (score >= 800) return { label: 'Excellent', color: 'text-emerald-600 dark:text-emerald-400' }
  if (score >= 740) return { label: 'Very good', color: 'text-emerald-600 dark:text-emerald-400' }
  if (score >= 670) return { label: 'Good', color: 'text-sky-600 dark:text-sky-400' }
  if (score >= 580) return { label: 'Fair', color: 'text-amber-600 dark:text-amber-400' }
  return { label: 'Poor', color: 'text-red-600 dark:text-red-400' }
}

export default function CreditTab({ scores = [], accounts = [], onAdd, onDelete }) {
  const cards = accounts.filter((a) => a.type === 'credit')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Credit</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Log the score you already see for free (Credit Karma, your bank, your card app) and track how
          it changes. We can’t pull your official score automatically — that’s protected credit-bureau
          data — but the biggest factor, card utilization, is computed below from your linked cards.
        </p>
      </div>

      <ScoreLog scores={scores} onAdd={onAdd} onDelete={onDelete} />
      <UtilizationPanel cards={cards} />
    </div>
  )
}

function ScoreLog({ scores, onAdd, onDelete }) {
  const isMobile = useIsMobile()
  const today = new Date().toISOString().slice(0, 10)
  const [score, setScore] = useState('')
  const [source, setSource] = useState(SOURCES[0])
  const [recordedOn, setRecordedOn] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const sorted = useMemo(
    () => [...scores].sort((a, b) => a.recorded_on.localeCompare(b.recorded_on)),
    [scores]
  )
  const latest = sorted[sorted.length - 1]
  const first = sorted[0]
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null

  const chartData = sorted.map((s) => ({
    date: s.recorded_on.slice(5), // MM-DD
    score: s.score,
  }))

  async function submit(e) {
    e.preventDefault()
    const n = parseInt(score, 10)
    if (Number.isNaN(n) || n < 300 || n > 850) {
      setError('Enter a score between 300 and 850.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAdd({ score: n, source, recordedOn, note })
      setScore('')
      setNote('')
      setRecordedOn(today)
    } catch (err) {
      setError(err.message || 'Could not save that score.')
    } finally {
      setBusy(false)
    }
  }

  const band = latest ? scoreBand(latest.score) : null
  const sinceLast = latest && prev ? latest.score - prev.score : null
  const sinceStart = latest && first && first.id !== latest.id ? latest.score - first.score : null

  const Delta = ({ value }) => {
    if (value == null) return null
    const up = value > 0
    const flat = value === 0
    return (
      <span
        className={
          flat
            ? 'text-slate-500 dark:text-slate-400'
            : up
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
        }
      >
        {flat ? 'no change' : `${up ? '▲ +' : '▼ '}${value} pts`}
      </span>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-4">
      {/* Current score + change summary */}
      {latest ? (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Latest score
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-slate-900 dark:text-slate-100">
                {latest.score}
              </span>
              <span className={`text-sm font-medium ${band.color}`}>{band.label}</span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {latest.source ? `${latest.source} · ` : ''}
              {latest.recorded_on}
            </p>
          </div>
          <div className="text-sm space-y-1">
            <p className="text-slate-500 dark:text-slate-400">
              Since last entry: <Delta value={sinceLast} />
            </p>
            {sinceStart != null && (
              <p className="text-slate-500 dark:text-slate-400">
                Since you started tracking: <Delta value={sinceStart} />
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No scores logged yet. Add your first one below to start tracking.
        </p>
      )}

      {/* Trend chart */}
      {chartData.length >= 2 && (
        <div className="h-48 md:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.4} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                interval={isMobile ? 'preserveStartEnd' : 0}
                minTickGap={isMobile ? 24 : 5}
              />
              <YAxis domain={['dataMin - 20', 'dataMax + 20']} tick={{ fontSize: 11 }} tickCount={isMobile ? 4 : 6} width={isMobile ? 40 : 60} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Add-a-score form */}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Score
          <input
            type="number"
            min="300"
            max="850"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="720"
            className="mt-1 w-24 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          From
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Date
          <input
            type="date"
            value={recordedOn}
            max={today}
            onChange={(e) => setRecordedOn(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-[8rem]">
          Note (optional)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. after paying down my card"
            className="mt-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 py-2 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save score'}
        </button>
        {error && <span className="w-full text-sm text-red-600 dark:text-red-400">{error}</span>}
      </form>

      {/* History list */}
      {sorted.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            History
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {[...sorted].reverse().map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">{s.score}</span>
                  <span className="text-slate-400 dark:text-slate-500">
                    {' '}
                    · {s.recorded_on}
                    {s.source ? ` · ${s.source}` : ''}
                    {s.note ? ` · ${s.note}` : ''}
                  </span>
                </span>
                <button
                  onClick={() => onDelete(s.id)}
                  className="text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                  title="Delete this entry"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Utilization = card balance / card limit. It's ~30% of a FICO score and the
// one big factor we can measure exactly from the cards the user linked, so this
// is the honest "what's affecting your score" panel.
function UtilizationPanel({ cards }) {
  const withLimit = cards.filter((c) => Number(c.credit_limit) > 0)
  const totalBal = withLimit.reduce((s, c) => s + (Number(c.current_balance) || 0), 0)
  const totalLimit = withLimit.reduce((s, c) => s + Number(c.credit_limit), 0)
  const overall = totalLimit > 0 ? Math.round((totalBal / totalLimit) * 100) : null

  // The card dragging utilization down the most (highest individual %).
  const ranked = [...withLimit]
    .map((c) => ({
      ...c,
      util: Math.round((Number(c.current_balance) / Number(c.credit_limit)) * 100),
    }))
    .sort((a, b) => b.util - a.util)
  const worst = ranked[0]

  if (withLimit.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
          What’s affecting your score
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Connect a credit card on the Transactions tab and we’ll show your real utilization here — the
          single biggest factor you can control.
        </p>
      </div>
    )
  }

  const good = overall != null && overall <= 30
  const barColor = good ? 'bg-emerald-500' : overall <= 50 ? 'bg-amber-500' : 'bg-red-500'
  const pctColor = good
    ? 'text-emerald-600 dark:text-emerald-400'
    : overall <= 50
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400'

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
          What’s affecting your score
        </h3>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-slate-600 dark:text-slate-300">
            Overall utilization ({fmt(totalBal)} of {fmt(totalLimit)})
          </span>
          <span className={`font-semibold ${pctColor}`}>{overall}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor}`}
            style={{ width: `${Math.min(100, overall)}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          {good
            ? 'Nice — keeping this under 30% is one of the best things for your score.'
            : `Getting this under 30% is the single biggest thing you can improve. ${
                worst && worst.util > overall
                  ? `Your ${worst.name || 'highest'} card is at ${worst.util}% — paying that one down would help the most.`
                  : ''
              }`}
        </p>
      </div>

      {/* Per-card breakdown */}
      <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
        {ranked.map((c) => {
          const cGood = c.util <= 30
          const cColor = cGood ? 'bg-emerald-500' : c.util <= 50 ? 'bg-amber-500' : 'bg-red-500'
          return (
            <div key={c.account_id}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-slate-600 dark:text-slate-300 truncate" title={c.name || 'Card'}>
                  {c.name || 'Card'}
                  {c.mask ? ` ••${c.mask}` : ''}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {fmt(c.current_balance)} / {fmt(c.credit_limit)} · {c.util}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className={`h-full rounded-full ${cColor}`}
                  style={{ width: `${Math.min(100, c.util)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
