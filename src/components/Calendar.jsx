import { useMemo, useState } from 'react'
import { addDays, todayISO, daysBetween } from '../lib/dateHelpers'
import { getUpcomingBills, getProjectedPaydays } from '../lib/calendarSources'
import { cleanMerchantName } from '../lib/merchantName'
import BottomSheet from './BottomSheet'

// Color + label per event kind, all from the semantic Deep-Navy tokens.
const KIND_STYLE = {
  shift: { dot: 'bg-interactive', text: 'text-interactive', label: 'Shift' },
  event: { dot: 'bg-warning', text: 'text-warning', label: 'Event' },
  bill: { dot: 'bg-danger', text: 'text-danger', label: 'Bill' },
  payday: { dot: 'bg-success', text: 'text-success', label: 'Payday' },
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function money(n) {
  return Math.round(Number(n)).toLocaleString()
}

// The user's LOCAL calendar date for a UTC timestamp — that's where the event
// belongs on the grid, regardless of the stored instant.
function localDate(iso) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function timeLabel(iso) {
  return new Date(iso)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .toLowerCase()
    .replace(' ', '')
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Flatten stored calendar_events + live bill/payday markers into one
// date-keyed map of display items.
function buildItemsByDate({ events, transactions, today, rangeEnd, overrides }) {
  const byDate = new Map()
  const push = (date, item) => {
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(item)
  }

  for (const e of events) {
    if (e.status === 'cancelled') continue
    push(localDate(e.starts_at), {
      id: e.id,
      kind: e.kind,
      title: e.title,
      amount: e.amount,
      time: timeLabel(e.starts_at),
      endTime: e.ends_at ? timeLabel(e.ends_at) : null,
      lowConfidence: false,
      event: e,
    })
  }

  const bills = getUpcomingBills(transactions, { today, rangeStart: today, rangeEnd, overrides })
  for (const b of bills) {
    push(b.date, { id: `bill-${b.external_id}-${b.date}`, kind: 'bill', title: b.title, amount: b.amount, time: null })
  }
  const paydays = getProjectedPaydays(transactions, { today, rangeStart: today, rangeEnd })
  for (const p of paydays) {
    push(p.date, { id: `payday-${p.external_id}-${p.date}`, kind: 'payday', title: p.title, amount: p.amount, time: null })
  }

  // Shifts first, then paydays, then bills, then events — keeps the grid tidy.
  const order = { shift: 0, payday: 1, bill: 2, event: 3 }
  for (const list of byDate.values()) list.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
  return byDate
}

// A checking→savings move imports as two transfer rows of the same amount (one
// per account). On a single day those legs are redundant, so keep one row per
// matched pair (rounding up for an unmatched single). Non-transfers pass through
// untouched and keep their original order.
function collapseTransferLegs(list) {
  const out = []
  const byAmount = new Map()
  for (const t of list) {
    if (t.kind !== 'transfer') {
      out.push(t)
      continue
    }
    const key = Math.round(Math.abs(Number(t.amount) || 0) * 100)
    byAmount.set(key, (byAmount.get(key) || 0) + 1)
  }
  for (const [key, count] of byAmount) {
    const amount = key / 100
    const shown = Math.max(1, Math.round(count / 2))
    for (let i = 0; i < shown; i++) {
      out.push({ id: `transfer-${key}-${i}`, kind: 'transfer', amount, note: null, category: null })
    }
  }
  return out
}

export default function Calendar({
  transactions = [],
  events = [],
  today = todayISO(),
  overrides = [],
  onCancelEvent,
  onDeleteSeries,
  entryBar = null,
}) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { year: y, month: m } // month is 1-12
  })
  const [selected, setSelected] = useState(null) // a stored calendar_event being edited
  const [busy, setBusy] = useState(false)
  const [selectedDay, setSelectedDay] = useState(null) // 'YYYY-MM-DD' whose day-detail is open

  const cancelSelected = async () => {
    if (!selected || !onCancelEvent) return setSelected(null)
    setBusy(true)
    try {
      await onCancelEvent(selected)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }
  const deleteSelectedSeries = async () => {
    if (!selected?.rule_id || !onDeleteSeries) return
    setBusy(true)
    try {
      await onDeleteSeries(selected.rule_id)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  // The window we render markers for: covers the visible month plus the next-7
  // strip, capped 8 weeks out (matches the materializer horizon).
  const rangeEnd = addDays(today, 56)
  const overridesMap = useMemo(() => new Map((overrides || []).map((o) => [o.merchant_key, o])), [overrides])
  const itemsByDate = useMemo(
    () => buildItemsByDate({ events, transactions, today, rangeEnd, overrides: overridesMap }),
    [events, transactions, today, rangeEnd, overridesMap]
  )

  // Actual recorded transactions grouped by their calendar date, for the grid
  // markers and the day-detail panel. Same-day transfer legs (a checking→savings
  // move posts as two rows) are collapsed into one so they don't double up.
  const transactionsByDate = useMemo(() => {
    const byDate = new Map()
    for (const t of transactions) {
      if (!t?.date) continue
      if (!byDate.has(t.date)) byDate.set(t.date, [])
      byDate.get(t.date).push(t)
    }
    for (const [date, list] of byDate) byDate.set(date, collapseTransferLegs(list))
    return byDate
  }, [transactions])

  // ---- month grid cells ----
  const { cells, monthTitle } = useMemo(() => {
    const first = `${cursor.year}-${String(cursor.month).padStart(2, '0')}-01`
    const firstDOW = new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate()
    const gridStart = addDays(first, -firstDOW)
    const weeks = Math.ceil((firstDOW + daysInMonth) / 7)
    const cells = []
    for (let i = 0; i < weeks * 7; i++) {
      const date = addDays(gridStart, i)
      cells.push({ date, inMonth: date.slice(0, 7) === first.slice(0, 7) })
    }
    const monthTitle = new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return { cells, monthTitle }
  }, [cursor])

  const goMonth = (delta) => {
    setCursor((c) => {
      const idx = (c.year * 12 + (c.month - 1)) + delta
      return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
    })
  }
  const goToday = () => {
    const [y, m] = today.split('-').map(Number)
    setCursor({ year: y, month: m })
  }

  // ---- next 7 days summary ----
  const next7 = useMemo(() => {
    const days = []
    let billsTotal = 0
    let shiftEarnings = 0
    let nextPayday = null
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i)
      const items = itemsByDate.get(date) || []
      if (items.length) days.push({ date, items })
      for (const it of items) {
        if (it.kind === 'bill') billsTotal += Number(it.amount || 0)
        if (it.kind === 'shift') shiftEarnings += Number(it.amount || 0)
        if (it.kind === 'payday' && !nextPayday) nextPayday = { date, amount: it.amount }
      }
    }
    return { days, billsTotal, shiftEarnings, nextPayday }
  }, [itemsByDate, today])

  // Cash-flow insight: the next projected paycheck anywhere in the window, and
  // the bills that land BEFORE it — the "can I cover rent before payday?" answer.
  const cashFlow = useMemo(() => {
    let nextPay = null
    for (let d = today; d <= rangeEnd; d = addDays(d, 1)) {
      const items = itemsByDate.get(d) || []
      const pay = items.find((it) => it.kind === 'payday')
      if (pay) {
        nextPay = { date: d, amount: Number(pay.amount || 0) }
        break
      }
    }
    if (!nextPay) return null
    let billsBefore = 0
    for (let d = today; d < nextPay.date; d = addDays(d, 1)) {
      for (const it of itemsByDate.get(d) || []) {
        if (it.kind === 'bill') billsBefore += Number(it.amount || 0)
      }
    }
    return { nextPay, billsBefore }
  }, [itemsByDate, today, rangeEnd])

  const paydayCountdown = next7.nextPayday
    ? (() => {
        const n = daysBetween(today, next7.nextPayday.date)
        return n === 0 ? 'Payday today' : `Payday in ${n} day${n === 1 ? '' : 's'}`
      })()
    : null

  return (
    <div className="space-y-6">
      {entryBar}

      {/* Next 7 days summary strip */}
      <section className="bg-surface rounded-xl border border-border shadow-sm p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Next 7 days</h2>
          {paydayCountdown && <span className="text-sm font-medium text-success">{paydayCountdown}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted">
          {next7.shiftEarnings > 0 && (
            <span>
              Est. shift earnings <span className="text-text font-medium">${money(next7.shiftEarnings)}</span>
            </span>
          )}
          {next7.billsTotal > 0 && (
            <span>
              Bills due <span className="text-text font-medium">${money(next7.billsTotal)}</span>
            </span>
          )}
        </div>

        {cashFlow && cashFlow.nextPay.amount > 0 && (
          <p className="mt-2 text-xs text-text-muted">
            Est. next paycheck <span className="text-success font-medium">${money(cashFlow.nextPay.amount)}</span>
            {' · '}
            Bills before then{' '}
            <span className={`font-medium ${cashFlow.billsBefore > cashFlow.nextPay.amount ? 'text-danger' : 'text-text'}`}>
              ${money(cashFlow.billsBefore)}
            </span>
          </p>
        )}

        {next7.days.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Nothing scheduled in the next 7 days.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {next7.days.map(({ date, items }) => (
              <li key={date} className="flex gap-3">
                <span className="w-16 shrink-0 text-xs font-medium text-text-muted pt-0.5">{dayLabel(date)}</span>
                <div className="min-w-0 flex flex-wrap gap-1.5">
                  {items.map((it) => (
                    <ItemChip key={it.id} item={it} onClick={it.event ? () => setSelected(it.event) : undefined} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Month grid */}
      <section className="bg-surface rounded-xl border border-border shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-text">{monthTitle}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goMonth(-1)}
              aria-label="Previous month"
              className="w-8 h-8 grid place-items-center rounded-md text-text-muted hover:bg-primary-tint hover:text-interactive transition"
            >
              ‹
            </button>
            <button
              onClick={goToday}
              className="px-2 h-8 rounded-md text-sm font-medium text-text-muted hover:bg-primary-tint hover:text-interactive transition"
            >
              Today
            </button>
            <button
              onClick={() => goMonth(1)}
              aria-label="Next month"
              className="w-8 h-8 grid place-items-center rounded-md text-text-muted hover:bg-primary-tint hover:text-interactive transition"
            >
              ›
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={i} className="text-center text-[11px] font-medium text-text-muted pb-1">
              {w}
            </div>
          ))}
          {cells.map(({ date, inMonth }) => {
            const items = itemsByDate.get(date) || []
            const txns = transactionsByDate.get(date) || []
            const isToday = date === today
            const isSelected = date === selectedDay
            // Scheduled/forecast markers first, then recorded transactions.
            const markers = [
              ...items.map((it) => ({
                key: it.id,
                dot: KIND_STYLE[it.kind]?.dot,
                label: it.kind === 'bill' || it.kind === 'payday' ? `$${money(it.amount)}` : it.time || it.title,
                onClick: it.event ? (e) => { e.stopPropagation(); setSelected(it.event) } : undefined,
              })),
              ...txns.map((t) => ({
                key: `txn-${t.id}`,
                dot: t.kind === 'income' ? 'bg-success' : 'bg-text-muted',
                label: `${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}$${money(t.amount)}`,
              })),
            ]
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDay(date)}
                aria-pressed={isSelected}
                className={`min-h-16 rounded-md border p-1 flex flex-col gap-0.5 text-left transition ${
                  isSelected
                    ? 'border-interactive ring-1 ring-interactive bg-primary-tint'
                    : inMonth
                      ? 'border-border bg-surface hover:bg-primary-tint/50'
                      : 'border-transparent bg-bg/40 hover:bg-bg/60'
                }`}
              >
                <span
                  className={`text-[11px] leading-4 ${
                    isToday
                      ? 'w-5 h-5 grid place-items-center rounded-full bg-primary text-on-primary font-semibold'
                      : inMonth
                        ? 'text-text'
                        : 'text-text-muted'
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {markers.slice(0, 3).map((m) => (
                    <span
                      key={m.key}
                      onClick={m.onClick}
                      className={`flex items-center gap-1 text-left ${m.onClick ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
                      <span className="truncate text-[10px] text-text-muted">{m.label}</span>
                    </span>
                  ))}
                  {markers.length > 3 && (
                    <span className="text-[10px] text-text-muted pl-2.5">+{markers.length - 3} more</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
          {Object.entries(KIND_STYLE).map(([kind, s]) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          ))}
        </div>
      </section>

      <EventSheet
        event={selected}
        busy={busy}
        onClose={() => setSelected(null)}
        onCancel={onCancelEvent ? cancelSelected : null}
        onDeleteSeries={onDeleteSeries ? deleteSelectedSeries : null}
      />

      <DayDetailSheet
        date={selectedDay}
        today={today}
        transactions={selectedDay ? transactionsByDate.get(selectedDay) || [] : []}
        items={selectedDay ? itemsByDate.get(selectedDay) || [] : []}
        onClose={() => setSelectedDay(null)}
        onSelectEvent={(e) => {
          setSelectedDay(null)
          setSelected(e)
        }}
      />
    </div>
  )
}

// Detail panel for a tapped calendar day. Two distinct sections: the recorded
// transactions that actually posted on that date (with a net total that
// excludes transfers), and — kept visually separate so they aren't mistaken for
// recorded spend — the day's scheduled/forecast markers (shifts, plus projected
// bills and paydays).
function DayDetailSheet({ date, today = todayISO(), transactions, items, onClose, onSelectEvent }) {
  const open = Boolean(date)
  const isFuture = date ? date > today : false
  const net = transactions.reduce((sum, t) => {
    if (t.kind === 'income') return sum + Number(t.amount || 0)
    if (t.kind === 'expense') return sum - Number(t.amount || 0)
    return sum // transfers don't move net
  }, 0)

  return (
    <BottomSheet open={open} onClose={onClose} title={date ? dayLabel(date) : ''}>
      <div className="space-y-5">
        {items.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text">Scheduled &amp; upcoming</h3>
            <p className="mt-0.5 text-xs text-text-muted">Shifts and forecast bills/paydays — not recorded spending.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {items.map((it) => (
                <ItemChip key={it.id} item={it} onClick={it.event ? () => onSelectEvent(it.event) : undefined} />
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-text">Transactions</h3>
            {transactions.length > 0 && (
              <span className={`text-sm font-medium ${net > 0 ? 'text-success' : net < 0 ? 'text-danger' : 'text-text-muted'}`}>
                {net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net))}
              </span>
            )}
          </div>
          {transactions.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">
              {isFuture ? "Nothing recorded yet — this day is upcoming." : 'No transactions on this day.'}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {transactions.map((t) => {
                const isTransfer = t.kind === 'transfer'
                const name = isTransfer ? 'Transfer' : t.note ? cleanMerchantName(t.note) : t.category?.name || 'Transaction'
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text">{name}</p>
                      {!isTransfer && t.category?.name && t.category.name !== name && (
                        <p className="truncate text-xs text-text-muted">{t.category.name}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium ${
                        t.kind === 'income' ? 'text-success' : isTransfer ? 'text-text-muted' : 'text-text'
                      }`}
                    >
                      {t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${money(t.amount)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}

// Edit sheet for a single stored shift/event. "Cancel this shift" marks the one
// instance cancelled (is_exception); "Delete whole series" removes the rule and
// all its instances. Bills/paydays are never editable here (they're not stored).
function EventSheet({ event, busy, onClose, onCancel, onDeleteSeries }) {
  const open = Boolean(event)
  const s = event ? KIND_STYLE[event.kind] || KIND_STYLE.event : null
  const when = event
    ? new Date(event.starts_at).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    : ''
  const time = event ? timeLabel(event.starts_at) : ''
  const endTime = event?.ends_at ? timeLabel(event.ends_at) : ''

  return (
    <BottomSheet open={open} onClose={onClose} title={event?.title || 'Shift'}>
      {event && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
            <span className="text-text font-medium">{s.label}</span>
            {event.status === 'cancelled' && (
              <span className="text-xs rounded-full bg-danger/10 text-danger px-2 py-0.5">Cancelled</span>
            )}
          </div>
          <div className="text-sm text-text-muted">
            <p className="text-text">{when}</p>
            <p>
              {time}
              {endTime ? `–${endTime}` : ''}
              {event.amount != null ? ` · $${money(event.amount)}` : ''}
            </p>
          </div>

          <div className="space-y-2">
            {onCancel && event.status !== 'cancelled' && (
              <button
                onClick={onCancel}
                disabled={busy}
                className="w-full rounded-lg border border-border text-text text-sm font-medium px-4 py-2.5 hover:bg-primary-tint transition disabled:opacity-60"
              >
                Cancel this shift
              </button>
            )}
            {onDeleteSeries && event.rule_id && (
              <button
                onClick={onDeleteSeries}
                disabled={busy}
                className="w-full rounded-lg text-danger text-sm font-medium px-4 py-2.5 hover:bg-danger/10 transition disabled:opacity-60"
              >
                Delete whole series
              </button>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

function ItemChip({ item, onClick }) {
  const s = KIND_STYLE[item.kind] || KIND_STYLE.event
  const label =
    item.kind === 'bill'
      ? `${item.title} · $${money(item.amount)}`
      : item.kind === 'payday'
        ? `${item.title} · $${money(item.amount)}`
        : `${item.title}${item.time ? ` · ${item.time}${item.endTime ? `–${item.endTime}` : ''}` : ''}${
            item.kind === 'shift' && item.amount ? ` · $${money(item.amount)}` : ''
          }`
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 text-xs ${s.text} ${
        onClick ? 'hover:bg-primary-tint transition' : ''
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className="text-text">{label}</span>
    </Tag>
  )
}
