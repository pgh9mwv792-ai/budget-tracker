export function monthKey(dateStr) {
  return dateStr.slice(0, 7) // 'YYYY-MM'
}

// The current calendar date in the user's LOCAL timezone as 'YYYY-MM-DD'.
// new Date().toISOString() gives the UTC date instead, which is already
// "tomorrow" for anyone behind UTC in the evening — that made the whole app
// jump a day ahead. Always use this for "today".
export function todayISO(reference = new Date()) {
  const y = reference.getFullYear()
  const m = String(reference.getMonth() + 1).padStart(2, '0')
  const d = String(reference.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isSameMonth(dateStr, reference = new Date()) {
  return monthKey(dateStr) === monthKey(todayISO(reference))
}

export function monthLabel(key) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// Returns the trailing N month keys ending at the current month, oldest first.
export function trailingMonthKeys(n, reference = new Date()) {
  const keys = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(reference.getFullYear(), reference.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

// Whole days between two 'YYYY-MM-DD' strings (b - a). Uses UTC noon to avoid
// daylight-saving edge cases.
export function daysBetween(a, b) {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)
  return Math.round(ms / 86400000)
}

// Adds n days to a 'YYYY-MM-DD' string and returns a 'YYYY-MM-DD' string.
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
