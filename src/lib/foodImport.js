// Import a food diary exported from MyFitnessPal or Cronometer into food-log
// drafts the user can review before committing. Pure parsing — no I/O, no writes.
//
// Both apps export one row per logged entry with the entry's TOTAL macros (for
// the amount eaten), so each row maps cleanly to one food_log at servings = 1.
// We keep only date / meal / name / calories / protein / carbs / fat; everything
// else (micros, times, notes) is dropped — the review step lets the user fix or
// exclude rows, and nothing is written until they confirm.

import Papa from 'papaparse'

// Find a column value by trying each candidate header (case-insensitive, and a
// loose "header contains candidate" fallback for the many near-identical export
// variants, e.g. "Protein (g)" vs "Protein").
function pick(row, keys, candidates) {
  const lowerMap = new Map(keys.map((k) => [k.toLowerCase().trim(), k]))
  for (const c of candidates) {
    const hit = lowerMap.get(c.toLowerCase())
    if (hit != null && row[hit] !== undefined) return row[hit]
  }
  for (const c of candidates) {
    for (const [lower, orig] of lowerMap) {
      if (lower.includes(c.toLowerCase())) return row[orig]
    }
  }
  return undefined
}

const num = (v) => {
  if (v == null) return 0
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Normalize a date cell to YYYY-MM-DD, or null when unparseable. Handles ISO
// dates and human formats ("January 15, 2024", "1/15/2024").
export function normalizeImportDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MEAL_MAP = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
  snacks: 'snack',
  supplement: 'supplement',
  supplements: 'supplement',
}

// Map an export's meal/group label to one of our meal keys, or null (→
// Uncategorized). Cronometer groups are free text and often blank.
export function normalizeMeal(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return MEAL_MAP[s] ?? null
}

// Which exporter produced these headers, by signature columns.
function detectFormat(headers) {
  const h = headers.map((x) => x.toLowerCase().trim())
  const has = (s) => h.some((x) => x.includes(s))
  if (has('food name') && has('energy')) return 'cronometer'
  if (has('food') && has('calories')) return 'myfitnesspal'
  // Cronometer exports vary; energy (kcal) + protein is a decent fallback.
  if (has('energy') && has('protein')) return 'cronometer'
  return null
}

// Parse a MyFitnessPal / Cronometer CSV string into review-ready drafts.
// Returns { format, rows, skipped, error }:
//   - format: 'myfitnesspal' | 'cronometer' | null (unrecognized)
//   - rows:   [{ date, meal, name, calories, protein, carbs, fat }]
//   - skipped: count of rows dropped for having no name or all-zero macros
//   - error:  a user-facing message when the file couldn't be used, else null
export function parseFoodCsv(text) {
  const parsed = Papa.parse(String(text ?? ''), {
    header: true,
    skipEmptyLines: true,
  })
  const data = parsed.data || []
  const headers = parsed.meta?.fields || (data[0] ? Object.keys(data[0]) : [])
  if (headers.length === 0 || data.length === 0) {
    return { format: null, rows: [], skipped: 0, error: 'This file has no rows we can read.' }
  }

  const format = detectFormat(headers)
  if (!format) {
    return {
      format: null,
      rows: [],
      skipped: 0,
      error:
        "This doesn't look like a MyFitnessPal or Cronometer export. Export your food diary as CSV and try again.",
    }
  }

  const rows = []
  let skipped = 0
  for (const raw of data) {
    const keys = Object.keys(raw)
    const name = String(pick(raw, keys, ['food name', 'food', 'name']) ?? '').trim()
    const calories = num(pick(raw, keys, ['energy (kcal)', 'energy', 'calories']))
    const protein = num(pick(raw, keys, ['protein (g)', 'protein']))
    const carbs = num(pick(raw, keys, ['carbs (g)', 'carbohydrates (g)', 'carbohydrates', 'carbs']))
    const fat = num(pick(raw, keys, ['fat (g)', 'fat']))
    if (!name || (calories === 0 && protein === 0 && carbs === 0 && fat === 0)) {
      skipped++
      continue
    }
    rows.push({
      date: normalizeImportDate(pick(raw, keys, ['date', 'day'])),
      meal: normalizeMeal(pick(raw, keys, ['meal', 'group'])),
      name,
      calories,
      protein,
      carbs,
      fat,
    })
  }

  if (rows.length === 0) {
    return { format, rows, skipped, error: 'No usable food entries were found in this file.' }
  }
  return { format, rows, skipped, error: null }
}
