// ---------------------------------------------------------------------------
// Deno/TS port of the pure insight math the weekly digest needs. The browser
// app keeps its own copies in JavaScript; keep these in sync when the logic
// changes:
//   • date helpers      -> src/lib/dateHelpers.js
//   • merchantKey       -> src/lib/analysis.js
//   • detectRecurring   -> src/lib/analysis.js
//   • classifyFoodTxn   -> src/lib/foodCost.js
//   • costPerDay        -> src/lib/foodCost.js
//   • costPerProtein    -> src/lib/foodCost.js
//
// Everything here is pure and deterministic (pass `today` so results don't shift
// around midnight). Transfers (kind === 'transfer') are excluded from every
// money figure, exactly like the frontend.
// ---------------------------------------------------------------------------

// ---------- date helpers (mirror src/lib/dateHelpers.js) ----------

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)
  return Math.round(ms / 86400000)
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---------- generic ----------

type Txn = {
  date: string
  amount: number | string
  kind: string
  note?: string | null
  category?: { name?: string | null } | null
  personal_finance_category?: unknown
}

function sum(txs: Txn[]): number {
  return txs.reduce((acc, t) => acc + Number(t.amount), 0)
}

function money(n: number): string {
  return Math.round(n).toLocaleString()
}

// ---------- merchant + recurring (mirror src/lib/analysis.js) ----------

export function merchantKey(note?: string | null): string {
  if (!note) return ''
  return note
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type Recurring = {
  key: string
  label: string
  kind: string
  amount: number
  cadence: string
  count: number
  lastDate: string
  nextDate: string
  overdue: boolean
}

export function detectRecurring(
  transactions: Txn[],
  { today = isoToday() }: { today?: string } = {},
): Recurring[] {
  const groups = new Map<string, Txn[]>()
  for (const t of transactions) {
    const key = merchantKey(t.note)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const results: Recurring[] = []
  for (const [key, txs] of groups) {
    if (txs.length < 2) continue

    const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date))
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length

    let cadence: string | null = null
    if (avgGap >= 6 && avgGap <= 8) cadence = 'weekly'
    else if (avgGap >= 12 && avgGap <= 16) cadence = 'every 2 weeks'
    else if (avgGap >= 25 && avgGap <= 35) cadence = 'monthly'
    if (!cadence) continue

    const last = sorted[sorted.length - 1]
    const avgAmount = txs.reduce((acc, t) => acc + Number(t.amount), 0) / txs.length
    const nextDate = addDays(last.date, Math.round(avgGap))
    results.push({
      key,
      label: last.note || key,
      kind: last.kind,
      amount: avgAmount,
      cadence,
      count: txs.length,
      lastDate: last.date,
      nextDate,
      overdue: nextDate < today,
    })
  }

  return results.sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
}

// ---------- food classification + cost (mirror src/lib/foodCost.js) ----------

const GROCERY_RE =
  /grocer|supermarket|whole foods|trader joe|safeway|kroger|aldi|costco|wegmans|publix|food lion|sprouts|market basket/i
const RESTAURANT_RE =
  /dining|restaurant|takeout|take-?out|fast food|coffee|cafe|chipotle|mcdonald|starbucks|doordash|uber ?eats|grubhub|pizza|taco|burger|sushi|deli|diner|panera|subway|wendy|blue bottle|bar & grill/i
const FOOD_GENERIC_RE = /\bfood\b|meal|snack|smoothie|supplement|\beat\b/i

export function classifyFoodTxn(t: Txn): 'grocery' | 'restaurant' | 'food' | null {
  const catName = t?.category?.name ?? ''
  const note = t?.note ?? ''
  const pfcRaw = t?.personal_finance_category as { primary?: string } | string | undefined
  const pfc = (typeof pfcRaw === 'string' ? pfcRaw : pfcRaw?.primary) ?? ''

  if (GROCERY_RE.test(catName) || GROCERY_RE.test(note) || /GROCER/i.test(pfc)) return 'grocery'
  if (
    RESTAURANT_RE.test(catName) ||
    RESTAURANT_RE.test(note) ||
    /RESTAURANT|FAST_FOOD|COFFEE|FOOD_AND_DRINK/i.test(pfc)
  )
    return 'restaurant'
  if (FOOD_GENERIC_RE.test(catName) || FOOD_GENERIC_RE.test(note)) return 'food'
  return null
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function costPerDay(
  transactions: Txn[],
  { today = isoToday(), days = 30 }: { today?: string; days?: number } = {},
) {
  const start = addDays(today, -(days - 1))
  let grocery = 0
  let restaurant = 0
  let other = 0
  let txnCount = 0

  for (const t of transactions) {
    if (t.kind !== 'expense') continue
    if (t.date < start || t.date > today) continue
    const cls = classifyFoodTxn(t)
    if (!cls) continue
    const amt = Number(t.amount) || 0
    if (cls === 'grocery') grocery += amt
    else if (cls === 'restaurant') restaurant += amt
    else other += amt
    txnCount++
  }

  const total = grocery + restaurant + other
  return {
    days,
    grocery,
    restaurant,
    other,
    total,
    perDay: total / days,
    txnCount,
    hasData: txnCount > 0,
  }
}

type FoodLog = {
  date: string
  servings?: number | string
  protein?: number | string
  cost?: number | string | null
}

export function costPerProtein(
  foodLogs: FoodLog[],
  { today = isoToday(), days = 30 }: { today?: string; days?: number } = {},
) {
  const start = addDays(today, -(days - 1))
  const inRange = foodLogs.filter((l) => l.date >= start && l.date <= today)

  let cost = 0
  let proteinWithCost = 0
  let mealsWithCost = 0

  for (const l of inRange) {
    const s = Number(l.servings) || 0
    const protein = (Number(l.protein) || 0) * s
    if (l.cost != null && l.cost !== '') {
      cost += (Number(l.cost) || 0) * s
      proteinWithCost += protein
      mealsWithCost++
    }
  }

  const meals = inRange.length
  const costPerGram = proteinWithCost > 0 ? cost / proteinWithCost : null
  return {
    days,
    meals,
    mealsWithCost,
    coverage: meals > 0 ? mealsWithCost / meals : null,
    cost,
    costPerGram,
    costPer100g: costPerGram == null ? null : costPerGram * 100,
    hasData: costPerGram != null && mealsWithCost >= 1,
  }
}

// ---------------------------------------------------------------------------
// Digest composition. Turns the raw server-pulled data into an ordered list of
// sections, each of which only appears when it has genuine signal. Returns the
// deterministic text and a subject line; the edge function optionally hands the
// text to Claude for a friendlier rewrite.
// ---------------------------------------------------------------------------

export type Section = { key: string; title: string; body: string }

type Goal = {
  name: string
  target_amount: number | string
  current_amount: number | string
}

export type DigestInput = {
  transactions?: Txn[]
  foodLogs?: FoodLog[]
  goals?: Goal[]
}

export function composeDigest(
  { transactions = [], foodLogs = [], goals = [] }: DigestInput,
  { today = isoToday() }: { today?: string } = {},
): { subject: string; sections: Section[]; text: string; weekStart: string } {
  const weekStart = addDays(today, -6) // inclusive 7-day window ending today
  const sections: Section[] = []

  // Only real income/expense rows feed the money math — transfers excluded.
  const spendable = transactions.filter((t) => t.kind === 'expense' || t.kind === 'income')

  // ---- 1. Spend vs. weekly average, with the top driver category ----
  const thisWeekExpenses = spendable.filter(
    (t) => t.kind === 'expense' && t.date >= weekStart && t.date <= today,
  )
  const weekSpend = sum(thisWeekExpenses)

  // Trailing ~90-day weekly average, using only the window BEFORE this week so
  // the comparison is "this week vs. how you normally do".
  const baselineStart = addDays(today, -97)
  const baselineEnd = addDays(today, -7)
  const baselineExpenses = spendable.filter(
    (t) => t.kind === 'expense' && t.date >= baselineStart && t.date <= baselineEnd,
  )
  const baselineWeeks = 90 / 7
  const avgWeekly = baselineExpenses.length > 0 ? sum(baselineExpenses) / baselineWeeks : null

  if (thisWeekExpenses.length > 0) {
    const byCat = new Map<string, number>()
    for (const t of thisWeekExpenses) {
      const name = t.category?.name ?? 'Uncategorized'
      byCat.set(name, (byCat.get(name) ?? 0) + Number(t.amount))
    }
    let topCategory: string | null = null
    let topAmount = 0
    for (const [name, amt] of byCat) {
      if (amt > topAmount) {
        topAmount = amt
        topCategory = name
      }
    }

    let body = `You spent $${money(weekSpend)} this week`
    if (avgWeekly != null && avgWeekly > 0) {
      const delta = (weekSpend - avgWeekly) / avgWeekly
      if (delta > 0.08) body += `, about ${Math.round(delta * 100)}% more than your usual $${money(avgWeekly)} a week`
      else if (delta < -0.08) body += `, about ${Math.round(Math.abs(delta) * 100)}% less than your usual $${money(avgWeekly)} a week`
      else body += `, right around your usual $${money(avgWeekly)} a week`
    }
    body += '.'
    if (topCategory) body += ` Most of it went to ${topCategory} ($${money(topAmount)}).`
    sections.push({ key: 'spend', title: 'This week’s spending', body })
  }

  // ---- 2. Food cost + cost-per-protein delta ----
  const foodThisWeek = costPerDay(transactions, { today, days: 7 })
  const proteinThisWeek = costPerProtein(foodLogs, { today, days: 7 })
  const proteinPrevWeek = costPerProtein(foodLogs, { today: addDays(today, -7), days: 7 })

  if (foodThisWeek.hasData || proteinThisWeek.hasData) {
    let body = ''
    if (foodThisWeek.hasData) {
      body += `Food ran about $${money(foodThisWeek.perDay)}/day this week`
      if (foodThisWeek.restaurant > 0 && foodThisWeek.grocery > 0) {
        const eatingOutPct = Math.round(
          (foodThisWeek.restaurant / (foodThisWeek.restaurant + foodThisWeek.grocery)) * 100,
        )
        body += ` (${eatingOutPct}% of it eating out)`
      }
      body += '.'
    }
    if (proteinThisWeek.hasData && proteinThisWeek.costPer100g != null) {
      body += ` Protein cost you $${proteinThisWeek.costPer100g.toFixed(2)} per 100g`
      if (proteinPrevWeek.hasData && proteinPrevWeek.costPerGram != null && proteinThisWeek.costPerGram != null) {
        const d = (proteinThisWeek.costPerGram - proteinPrevWeek.costPerGram) / proteinPrevWeek.costPerGram
        if (d > 0.05) body += `, up ${Math.round(d * 100)}% from last week`
        else if (d < -0.05) body += `, down ${Math.round(Math.abs(d) * 100)}% from last week`
      }
      body += '.'
    }
    sections.push({ key: 'food', title: 'Food & protein', body: body.trim() })
  }

  // ---- 3. Upcoming recurring charges in the next 7 days ----
  const recurring = detectRecurring(transactions, { today })
  const horizon = addDays(today, 7)
  const upcomingBills = recurring.filter(
    (r) => r.kind === 'expense' && r.nextDate >= today && r.nextDate <= horizon,
  )
  if (upcomingBills.length > 0) {
    const parts = upcomingBills
      .slice(0, 4)
      .map((r) => `${r.label} (~$${money(r.amount)}, around ${r.nextDate.slice(5)})`)
    sections.push({
      key: 'upcoming',
      title: 'Coming up this week',
      body: `Heads up on likely charges: ${parts.join('; ')}.`,
    })
  }

  // ---- 4. Goal pace, inferred from your net savings rate ----
  const win90Start = addDays(today, -89)
  const win90 = spendable.filter((t) => t.date >= win90Start && t.date <= today)
  const income90 = sum(win90.filter((t) => t.kind === 'income'))
  const expense90 = sum(win90.filter((t) => t.kind === 'expense'))
  const monthlyNet = (income90 - expense90) / 3

  const completed = goals.find((g) => Number(g.current_amount) >= Number(g.target_amount) && Number(g.target_amount) > 0)
  if (completed) {
    sections.push({
      key: 'goal',
      title: 'Goal reached',
      body: `You’ve hit your ${completed.name} goal of $${money(Number(completed.target_amount))} — nice work.`,
    })
  } else if (monthlyNet > 0) {
    // The incomplete goal you'll finish soonest at the current savings rate.
    let best: { name: string; remaining: number; months: number } | null = null
    for (const g of goals) {
      const target = Number(g.target_amount) || 0
      const current = Number(g.current_amount) || 0
      const remaining = target - current
      if (target <= 0 || remaining <= 0) continue
      const months = remaining / monthlyNet
      if (!best || months < best.months) best = { name: g.name, remaining, months }
    }
    if (best) {
      const when =
        best.months <= 1
          ? 'about a month'
          : best.months < 12
            ? `about ${Math.round(best.months)} months`
            : `about ${(best.months / 12).toFixed(1)} years`
      sections.push({
        key: 'goal',
        title: 'Goal pace',
        body: `At your recent savings rate (~$${money(monthlyNet)}/mo), you’re on pace to reach ${best.name} in ${when} — $${money(best.remaining)} to go.`,
      })
    }
  }

  // ---- 5. One anomaly: an unusually large purchase this week ----
  if (thisWeekExpenses.length >= 4 && weekSpend > 0) {
    const biggest = thisWeekExpenses.reduce((a, t) => (Number(t.amount) > Number(a.amount) ? t : a))
    if (Number(biggest.amount) > weekSpend * 0.4) {
      const label = biggest.note || biggest.category?.name || 'One purchase'
      sections.push({
        key: 'anomaly',
        title: 'Biggest purchase',
        body: `Your largest single purchase this week was ${label} at $${money(Number(biggest.amount))}.`,
      })
    }
  }

  const subject =
    weekSpend > 0 ? `Your week in review — $${money(weekSpend)} spent` : 'Your weekly money + food recap'
  const text = sections.map((s) => s.body).join(' ')

  return { subject, sections, text, weekStart }
}
