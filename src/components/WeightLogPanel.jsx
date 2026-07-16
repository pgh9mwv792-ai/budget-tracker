import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { useThemeColors } from '../lib/colors'
import { useIsMobile } from '../lib/useMediaQuery'
import { todayISO, daysBetween } from '../lib/dateHelpers'
import {
  rollingAverage,
  getPace,
  kgToLb,
  formatWeight,
  parseWeightInput,
} from '../lib/goals'
import BottomSheet from './BottomSheet'

const CHART_HEIGHT = 240

// Convert a stored kilogram value into the user's display units (number only).
function toDisplay(kg, unit) {
  if (kg == null) return null
  return unit === 'metric' ? Number(kg) : kgToLb(kg)
}

export default function WeightLogPanel({
  weightLogs = [],
  profile,
  weightGoal,
  onQuickLog,
  onUpdateEntry,
  onDeleteEntry,
}) {
  const { theme } = useTheme()
  const colors = useThemeColors(theme)
  const isMobile = useIsMobile()
  const unit = profile?.unit_preference || 'imperial'
  const unitLabel = unit === 'metric' ? 'kg' : 'lb'

  const [input, setInput] = useState('')
  const [logging, setLogging] = useState(false)
  const [selected, setSelected] = useState(null) // the weight_log row being edited

  const sorted = useMemo(
    () => [...weightLogs].sort((a, b) => (a.logged_on < b.logged_on ? -1 : 1)),
    [weightLogs]
  )

  const today = todayISO()
  const currentAvgKg = rollingAverage(sorted, { asOf: today })

  // Build the chart series: raw daily dots + the 7-day rolling-average line, both
  // in display units, plus a dashed projection segment toward the goal target.
  const { chartData, yDomain, projectedDate } = useMemo(() => {
    if (sorted.length === 0) return { chartData: [], yDomain: [0, 1], projectedDate: null }

    const rows = sorted.map((l) => {
      const avgKg = rollingAverage(sorted, { asOf: l.logged_on })
      return {
        id: l.id,
        date: l.logged_on,
        note: l.note,
        raw: round1(toDisplay(l.weight_kg, unit)),
        avg: round1(toDisplay(avgKg, unit)),
      }
    })

    // Projection: only when there's an active weight goal and a real trend toward
    // it. Pace is computed in kilograms (matching the stored goal target), then
    // the target is plotted in display units at the projected date.
    let projected = null
    if (weightGoal) {
      const history = sorted.map((l) => ({ date: l.logged_on, value: Number(l.weight_kg) }))
      const pace = getPace(weightGoal, history, { today })
      if (pace.projectedDate && daysBetween(today, pace.projectedDate) > 0) {
        projected = pace.projectedDate
        const targetDisplay = round1(toDisplay(Number(weightGoal.target_value), unit))
        // Anchor the dashed line at the last real average, then reach the target.
        rows[rows.length - 1].projection = rows[rows.length - 1].avg
        rows.push({ date: projected, raw: null, avg: null, projection: targetDisplay })
      }
    }

    // Y-axis padded ~5 lb (or ~2.3 kg) beyond the data so points never hug edges.
    const pad = unit === 'metric' ? 2.3 : 5
    const values = rows.flatMap((r) => [r.raw, r.avg, r.projection]).filter((v) => v != null)
    const min = Math.min(...values)
    const max = Math.max(...values)
    return {
      chartData: rows,
      yDomain: [Math.floor(min - pad), Math.ceil(max + pad)],
      projectedDate: projected,
    }
  }, [sorted, unit, weightGoal, today])

  async function handleQuickLog(e) {
    e.preventDefault()
    const kg = parseWeightInput(input, unit)
    if (kg == null) return
    setLogging(true)
    try {
      await onQuickLog({ weightKg: kg, loggedOn: today })
      setInput('')
    } finally {
      setLogging(false)
    }
  }

  const startKg = sorted.length ? Number(sorted[0].weight_kg) : null
  const change30Kg = thirtyDayChangeKg(sorted, today)

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      {/* Header + inline quick-log */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">Weight log</h3>
        <form onSubmit={handleQuickLog} className="flex items-center gap-2">
          <div className="relative">
            <input
              type="number"
              step="0.1"
              min="0"
              inputMode="decimal"
              placeholder={`Today's weight`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-40 rounded-md border border-border bg-surface text-text pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
              {unitLabel}
            </span>
          </div>
          <button
            type="submit"
            disabled={logging || parseWeightInput(input, unit) == null}
            className="rounded-md bg-primary text-on-primary text-sm px-4 min-h-11 sm:min-h-0 sm:py-2 font-medium hover:bg-primary-hover transition disabled:opacity-50"
          >
            Log today
          </button>
        </form>
      </div>

      {/* Chart (fixed-height container → no layout shift while the tab chunk loads) */}
      <div className="mt-4" style={{ height: CHART_HEIGHT }}>
        {sorted.length === 0 ? (
          <div className="h-full grid place-items-center text-center rounded-lg border border-dashed border-border bg-bg/50 px-6">
            <p className="text-sm text-text-muted">
              No weigh-ins yet — log your first above to start the trend line.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: isMobile ? -16 : -8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: isMobile ? 10 : 12, fill: 'currentColor' }}
                className="text-text-muted"
                tickFormatter={shortDate}
                minTickGap={isMobile ? 24 : 16}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: isMobile ? 10 : 12, fill: 'currentColor' }}
                className="text-text-muted"
                width={isMobile ? 34 : 44}
                allowDecimals={false}
              />
              <Tooltip content={<WeightTooltip unitLabel={unitLabel} />} />
              {/* Raw daily weigh-ins: small muted dots, clickable to edit/delete. */}
              <Scatter
                dataKey="raw"
                fill={colors.textMuted}
                isAnimationActive={false}
                onClick={(d) => d?.payload?.id && setSelected(sorted.find((l) => l.id === d.payload.id))}
                style={{ cursor: 'pointer' }}
              />
              {/* 7-day rolling average: solid accent line. */}
              <Line
                type="monotone"
                dataKey="avg"
                stroke={colors.interactive}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              {/* Projection toward the goal target: dashed continuation. */}
              <Line
                type="linear"
                dataKey="projection"
                stroke={colors.primary}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stats strip */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <Stat label="Height" value={formatHeight(profile?.height_cm, unit)} />
        <Stat label="Start" value={startKg == null ? '—' : formatWeight(startKg, unit)} />
        <Stat label="Current (7-day avg)" value={currentAvgKg == null ? '—' : formatWeight(currentAvgKg, unit)} />
        <Stat
          label="30-day change"
          value={change30Kg == null ? '—' : formatSignedWeight(change30Kg, unit)}
          tone={change30Kg == null ? 'muted' : change30Kg < 0 ? 'success' : 'text'}
        />
      </div>

      {projectedDate && (
        <p className="mt-3 text-xs text-text-muted text-center">
          Dashed line projects your current trend toward the goal — on track for about {shortDate(projectedDate)}.
        </p>
      )}

      {/* Edit / delete one entry */}
      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title="Edit weigh-in">
        {selected && (
          <EditEntry
            entry={selected}
            unit={unit}
            unitLabel={unitLabel}
            onSave={async (kg) => {
              await onUpdateEntry(selected.id, { weight_kg: kg })
              setSelected(null)
            }}
            onDelete={async () => {
              await onDeleteEntry(selected.id)
              setSelected(null)
            }}
          />
        )}
      </BottomSheet>
    </div>
  )
}

function EditEntry({ entry, unit, unitLabel, onSave, onDelete }) {
  const [value, setValue] = useState(String(round1(toDisplay(Number(entry.weight_kg), unit))))
  const [busy, setBusy] = useState(false)
  const kg = parseWeightInput(value, unit)

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{longDate(entry.logged_on)}</p>
      <div className="relative">
        <input
          type="number"
          step="0.1"
          min="0"
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-md border border-border bg-surface text-text pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">{unitLabel}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={async () => {
            setBusy(true)
            try {
              await onDelete()
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
          className="text-sm font-medium text-danger hover:text-danger/80 disabled:opacity-50"
        >
          Delete
        </button>
        <button
          onClick={async () => {
            if (kg == null) return
            setBusy(true)
            try {
              await onSave(kg)
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy || kg == null}
          className="rounded-md bg-primary text-on-primary text-sm px-4 py-2 font-medium hover:bg-primary-hover transition disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, tone = 'text' }) {
  const toneClass =
    tone === 'success' ? 'text-success' : tone === 'muted' ? 'text-text-muted' : 'text-text'
  return (
    <div className="rounded-lg border border-border bg-bg/50 px-2 py-2">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className={`text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}

function WeightTooltip({ active, payload, unitLabel }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-text">{longDate(row.date)}</p>
      {row.raw != null && (
        <p className="text-text-muted">
          Weigh-in: <span className="text-text">{row.raw} {unitLabel}</span>
        </p>
      )}
      {row.avg != null && (
        <p className="text-text-muted">
          7-day avg: <span className="text-interactive">{row.avg} {unitLabel}</span>
        </p>
      )}
    </div>
  )
}

// ------------------------------- helpers -----------------------------------
function round1(v) {
  if (v == null) return null
  return Math.round(v * 10) / 10
}

function thirtyDayChangeKg(sorted, today) {
  if (sorted.length < 2) return null
  const latest = Number(sorted[sorted.length - 1].weight_kg)
  // The entry closest to 30 days ago (the oldest within, or failing that the
  // very first entry) — gives a meaningful "last 30 days" delta on short logs.
  const cutoff = sorted.filter((l) => daysBetween(l.logged_on, today) <= 30)
  const baseline = cutoff.length ? Number(cutoff[0].weight_kg) : Number(sorted[0].weight_kg)
  return latest - baseline
}

function formatHeight(cm, unit) {
  if (cm == null) return '—'
  if (unit === 'metric') return `${Math.round(cm)} cm`
  const totalInches = cm / 2.54
  const ft = Math.floor(totalInches / 12)
  const inch = Math.round(totalInches - ft * 12)
  return `${ft}'${inch}"`
}

function formatSignedWeight(kg, unit) {
  const s = formatWeight(Math.abs(kg), unit)
  return `${kg < 0 ? '−' : '+'}${s}`
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
