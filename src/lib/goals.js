// Pure progress engine shared by every goal — financial and fitness alike.
// No React in this file; everything here is unit-testable (see goals.test.js).
//
// A goal has one shape regardless of type:
//   { type, title, start_value, target_value, direction, deadline,
//     tracking, source_ref, current_value, status }
// `direction` is 'increase' (save more, gain weight) or 'decrease' (pay down
// debt, lose weight, spend less). Auto-tracked goals resolve their current
// value from live app data via source_ref; manual goals store current_value.

import { todayISO, addDays, daysBetween, monthKey } from './dateHelpers'

// ------------------------------- units -------------------------------------
// Everything about weight is stored in kilograms. Display converts per the
// user's unit_preference; input parses back to kilograms.
const KG_PER_LB = 0.45359237

export function kgToLb(kg) {
  return Number(kg) / KG_PER_LB
}

export function lbToKg(lb) {
  return Number(lb) * KG_PER_LB
}

// A weight in kg rendered in the user's units, to one decimal (e.g. "154.3 lb").
// `withUnit: false` returns just the number string, for inline "/ target" bits.
export function formatWeight(kg, unitPreference = 'imperial', { withUnit = true } = {}) {
  if (kg == null || !Number.isFinite(Number(kg))) return withUnit ? '—' : '—'
  const metric = unitPreference === 'metric'
  const value = metric ? Number(kg) : kgToLb(kg)
  const rounded = value.toFixed(1)
  return withUnit ? `${rounded} ${metric ? 'kg' : 'lb'}` : rounded
}

// Parse a user-typed weight (in their units) back into kilograms for storage.
// Returns null for blank/invalid input so callers can reject it.
export function parseWeightInput(value, unitPreference = 'imperial') {
  const n = Number(value)
  if (value === '' || value == null || !Number.isFinite(n) || n <= 0) return null
  return unitPreference === 'metric' ? n : lbToKg(n)
}

// ------------------------- weight rolling average --------------------------
// The 7-day rolling average smooths daily water-weight noise. We average the
// weigh-ins within the trailing `windowDays` ending at `asOf`; if none fall in
// that window we fall back to the most recent entry on/before asOf.
export function rollingAverage(logs, { asOf = todayISO(), windowDays = 7 } = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return null
  const windowStart = addDays(asOf, -(windowDays - 1))
  const inWindow = logs.filter((l) => l.logged_on >= windowStart && l.logged_on <= asOf)
  if (inWindow.length > 0) {
    const sum = inWindow.reduce((acc, l) => acc + Number(l.weight_kg), 0)
    return sum / inWindow.length
  }
  const past = logs
    .filter((l) => l.logged_on <= asOf)
    .sort((a, b) => (a.logged_on < b.logged_on ? 1 : -1))
  return past.length ? Number(past[0].weight_kg) : null
}

// --------------------------- spend-limit helper ----------------------------
// A "spend less on a category" goal: decrease-direction financial goal tracked
// from a budget category. Its progress/status semantics differ from every other
// goal (it's a limit you're trying to stay under, not a target to reach).
export function isSpendLimit(goal) {
  return (
    goal?.type === 'financial' &&
    goal?.direction === 'decrease' &&
    goal?.source_ref?.kind === 'budget_category'
  )
}

// Sum of this month's expense transactions for one category (the live spend a
// spend-limit goal is measured against).
export function currentPeriodSpend(transactions, categoryId, today = todayISO()) {
  if (!Array.isArray(transactions)) return 0
  const mk = monthKey(today)
  return transactions
    .filter(
      (t) =>
        t.category_id === categoryId &&
        t.kind === 'expense' &&
        typeof t.date === 'string' &&
        monthKey(t.date) === mk
    )
    .reduce((acc, t) => acc + Number(t.amount), 0)
}

// ---------------------------- current value --------------------------------
// Resolve a goal's current progress value. Manual goals use their stored
// current_value; auto goals read live data from `ctx`:
//   ctx = { weightLogs, accounts, transactions, today }
export function getCurrentValue(goal, ctx = {}) {
  const today = ctx.today || todayISO()
  if (goal.tracking === 'manual') return num(goal.current_value)

  const ref = goal.source_ref || {}
  switch (ref.kind) {
    case 'weight_log':
      return rollingAverage(ctx.weightLogs || [], { asOf: today })
    case 'account': {
      const acct = (ctx.accounts || []).find((a) => a.account_id === ref.id)
      return acct ? Number(acct.current_balance) : null
    }
    case 'budget_category':
      return currentPeriodSpend(ctx.transactions || [], ref.id, today)
    default:
      return num(goal.current_value)
  }
}

// ------------------------------ progress % ---------------------------------
// Percentage 0..100 of the way to the good outcome, handling both directions.
//   • increase: how much of (target − start) has been gained.
//   • decrease (debt/weight): how much of (start − target) has been closed.
//   • spend-limit: how much of the limit has been used (bar fills as you spend).
// For a spend-limit the *bar* shows usage; the on-pace/behind judgement lives in
// getStatus (projected overspend), never raw percent — see the spec note.
export function getProgressPct(goal, current) {
  const cur = num(current)
  if (cur == null) return 0
  const start = num(goal.start_value) ?? 0
  const target = num(goal.target_value)
  if (target == null) return 0

  if (isSpendLimit(goal)) {
    if (target === 0) return 100
    return clampPct((cur / target) * 100)
  }
  if (goal.direction === 'increase') {
    const span = target - start
    if (span <= 0) return cur >= target ? 100 : 0
    return clampPct(((cur - start) / span) * 100)
  }
  // decrease (pay off debt, lose weight)
  const span = start - target
  if (span <= 0) return cur <= target ? 100 : 0
  return clampPct(((start - cur) / span) * 100)
}

// Whether the goal's target has been met (used for the "done" status/pill).
// Spend-limit goals are ongoing within a period and never report "reached".
export function reachedTarget(goal, current) {
  const cur = num(current)
  const target = num(goal.target_value)
  if (cur == null || target == null) return false
  if (isSpendLimit(goal)) return false
  return goal.direction === 'increase' ? cur >= target : cur <= target
}

// -------------------------------- pace -------------------------------------
// Simple least-squares linear fit over the last 30 days of {date, value} data
// points. Returns the daily/weekly rate and a projected date the goal's target
// is reached (only when the trend is actually moving toward it). With fewer than
// two points there's no line to fit, so `insufficient` is true and no
// projection is shown.
export function getPace(goal, history, { today = todayISO(), windowDays = 30 } = {}) {
  const empty = { ratePerDay: null, ratePerWeek: null, projectedDate: null, insufficient: true }
  if (!Array.isArray(history)) return empty

  const cutoff = addDays(today, -windowDays)
  const pts = history
    .filter((p) => p && p.date >= cutoff && p.date <= today && Number.isFinite(Number(p.value)))
    .map((p) => ({ x: daysBetween(cutoff, p.date), y: Number(p.value) }))
    .sort((a, b) => a.x - b.x)

  if (pts.length < 2) return empty

  const { slope, intercept } = linearFit(pts)
  const ratePerDay = slope
  const ratePerWeek = slope * 7

  let projectedDate = null
  const target = num(goal.target_value)
  if (target != null && slope !== 0) {
    const xAtTarget = (target - intercept) / slope
    if (Number.isFinite(xAtTarget)) {
      const projected = addDays(cutoff, Math.round(xAtTarget))
      const movingToward =
        (goal.direction === 'increase' && slope > 0) ||
        (goal.direction === 'decrease' && slope < 0)
      if (movingToward && projected >= today) projectedDate = projected
    }
  }

  return { ratePerDay, ratePerWeek, projectedDate, insufficient: false }
}

// ------------------------------- status ------------------------------------
// 'done' | 'on_pace' | 'behind'.
//
// Spend-limit goals: "behind" means PROJECTED overspend — spend so far plus
// (daily rate × days left in the month) exceeds the limit. This is deliberately
// NOT "percent already spent": $318 of $400 with 12 days left is behind, but the
// same $318 with 2 days left is on pace. Pass ctx.periodDaysRemaining to make
// the period boundary explicit (defaults to days left in the current month).
//
// Every other goal: "behind" means the linear projection reaches the target
// after its deadline (or the trend isn't moving toward it). With no deadline or
// no usable projection we don't cry wolf — it stays 'on_pace'.
export function getStatus(goal, current, pace, ctx = {}) {
  const today = ctx.today || todayISO()

  if (isSpendLimit(goal)) {
    const cur = num(current) ?? 0
    const limit = num(goal.target_value)
    if (limit == null) return 'on_pace'
    const daysLeft =
      ctx.periodDaysRemaining != null ? ctx.periodDaysRemaining : daysLeftInMonth(today)
    const ratePerDay = pace?.ratePerDay
    if (ratePerDay == null) {
      // No trend yet: only flag if already over the limit.
      return cur > limit ? 'behind' : 'on_pace'
    }
    const projectedTotal = cur + ratePerDay * daysLeft
    return projectedTotal > limit ? 'behind' : 'on_pace'
  }

  if (reachedTarget(goal, current)) return 'done'

  if (!pace || pace.insufficient || pace.projectedDate == null) return 'on_pace'
  if (goal.deadline && pace.projectedDate > goal.deadline) return 'behind'
  return 'on_pace'
}

// ------------------------------ internals ----------------------------------
function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clampPct(p) {
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(100, p))
}

// Least-squares slope/intercept for y = slope·x + intercept.
function linearFit(pts) {
  const n = pts.length
  const sumX = pts.reduce((a, p) => a + p.x, 0)
  const sumY = pts.reduce((a, p) => a + p.y, 0)
  const sumXY = pts.reduce((a, p) => a + p.x * p.y, 0)
  const sumXX = pts.reduce((a, p) => a + p.x * p.x, 0)
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// Whole days remaining in the current calendar month, counting today (so on the
// last day of the month, one day remains).
function daysLeftInMonth(today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return lastDay - d + 1
}
