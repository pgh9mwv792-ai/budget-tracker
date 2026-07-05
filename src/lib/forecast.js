import { monthKey, addDays } from './dateHelpers'
import { detectRecurring } from './analysis'

function sum(txs) {
  return txs.reduce((acc, t) => acc + Number(t.amount), 0)
}

// Computes a single "how am I doing this month?" snapshot from the raw
// transactions + budgets. Pure function (no React, no Date.now surprises — pass
// `today` to make it testable) so the Dashboard, the AI summary, and future
// tests can all share the exact same math.
//
// Two modes:
//   • Budget mode  (the user has set any budgets): the headline number is
//     "safe to spend" = total budget − spent-in-budgeted-categories − known
//     bills still due this month. This answers "how much can I spend and still
//     be fine?" which is the emotional job of the app.
//   • No-budget mode: falls back to net (income − expenses) this month, plus a
//     projection that folds in recurring income/bills still expected.
export function computeMonthOutlook(
  transactions = [],
  budgets = [],
  { today = new Date().toISOString().slice(0, 10) } = {}
) {
  const month = monthKey(today)
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate() // day 0 of next month
  const dayOfMonth = Number(today.slice(8, 10))
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth)
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`

  const monthTx = transactions.filter((t) => monthKey(t.date) === month)
  const income = sum(monthTx.filter((t) => t.kind === 'income'))
  const spent = sum(monthTx.filter((t) => t.kind === 'expense'))
  const net = income - spent

  // Budgets are { category_id, amount }. Total across all of them, and the
  // spend that lands in a budgeted category (matches BudgetManager's logic so
  // the numbers agree between screens).
  const budgetTotal = budgets.reduce((acc, b) => acc + Number(b.amount || 0), 0)
  const hasBudget = budgetTotal > 0
  const budgetedCategoryIds = new Set(budgets.map((b) => b.category_id))
  const spentBudgeted = sum(
    monthTx.filter((t) => t.kind === 'expense' && t.category_id && budgetedCategoryIds.has(t.category_id))
  )

  // Recurring items whose next expected date still falls inside this month,
  // from today onward. These are the "known bills / income still coming".
  const recurring = detectRecurring(transactions, { today })
  const upcoming = recurring.filter((r) => r.nextDate >= today && r.nextDate <= monthEnd)
  const upcomingExpenses = upcoming.filter((r) => r.kind === 'expense').reduce((a, r) => a + r.amount, 0)
  const upcomingIncome = upcoming.filter((r) => r.kind === 'income').reduce((a, r) => a + r.amount, 0)

  const isEmpty = monthTx.length === 0 && !hasBudget

  let primary
  let verdict

  if (isEmpty) {
    primary = { amount: 0, label: 'Nothing tracked yet this month' }
    verdict = {
      tone: 'neutral',
      headline: 'Let’s see where you stand',
      sub: 'Add a transaction or connect a bank and your monthly picture shows up here.',
    }
  } else if (hasBudget) {
    const leftInBudget = budgetTotal - spentBudgeted
    const safeToSpend = leftInBudget - upcomingExpenses
    // Where "should" spending be by this point in the month if it were even.
    const expectedByNow = budgetTotal * (dayOfMonth / daysInMonth)
    const overPace = spentBudgeted > expectedByNow * 1.1

    primary = { amount: safeToSpend, label: 'safe to spend this month' }

    if (safeToSpend < 0) {
      verdict = {
        tone: 'bad',
        headline: `You’re $${money(Math.abs(safeToSpend))} over your plan`,
        sub:
          upcomingExpenses > 0
            ? `That includes $${money(upcomingExpenses)} in bills still due. Time to ease off or adjust a budget.`
            : 'You’ve spent more than you budgeted. Time to ease off or adjust a budget.',
      }
    } else if (overPace) {
      verdict = {
        tone: 'warn',
        headline: 'Spending a little faster than planned',
        sub: `You’ve got $${money(safeToSpend)} left after known bills, but you’re ahead of pace with ${daysLeft} days to go.`,
      }
    } else {
      verdict = {
        tone: 'good',
        headline: 'You’re on track',
        sub: `$${money(safeToSpend)} left to spend after known bills, with ${daysLeft} days to go.`,
      }
    }

    return {
      today,
      month,
      daysInMonth,
      dayOfMonth,
      daysLeft,
      income,
      spent,
      net,
      hasBudget,
      budgetTotal,
      spentBudgeted,
      leftInBudget,
      safeToSpend,
      expectedByNow,
      overPace,
      upcoming,
      upcomingExpenses,
      upcomingIncome,
      primary,
      verdict,
    }
  } else {
    // No budgets set — reason about net cash flow instead.
    const projectedNet = net + upcomingIncome - upcomingExpenses
    primary = { amount: net, label: net >= 0 ? 'net saved this month' : 'net spent this month' }

    if (projectedNet < 0) {
      verdict = {
        tone: 'bad',
        headline: `Headed for about $${money(Math.abs(projectedNet))} in the red`,
        sub:
          upcomingExpenses > 0
            ? `After $${money(upcomingExpenses)} in bills still due this month, spending is outpacing income.`
            : 'Spending is outpacing income this month.',
      }
    } else if (net < 0) {
      verdict = {
        tone: 'warn',
        headline: 'Spending more than you’ve earned so far',
        sub:
          upcomingIncome > 0
            ? `But $${money(upcomingIncome)} in income is still expected — projected to end about $${money(projectedNet)} ahead.`
            : `You’re down $${money(Math.abs(net))} so far this month.`,
      }
    } else {
      verdict = {
        tone: 'good',
        headline: 'You’re net positive this month',
        sub: `$${money(net)} more in than out so far. Set a budget to get a clearer "safe to spend" number.`,
      }
    }

    return {
      today,
      month,
      daysInMonth,
      dayOfMonth,
      daysLeft,
      income,
      spent,
      net,
      hasBudget,
      budgetTotal: 0,
      spentBudgeted: 0,
      upcoming,
      upcomingExpenses,
      upcomingIncome,
      projectedNet,
      primary,
      verdict,
    }
  }

  return {
    today,
    month,
    daysInMonth,
    dayOfMonth,
    daysLeft,
    income,
    spent,
    net,
    hasBudget,
    upcoming,
    upcomingExpenses,
    upcomingIncome,
    primary,
    verdict,
  }
}

// Money without cents, thousands-separated: 1234.5 -> "1,235".
function money(n) {
  return Math.round(n).toLocaleString()
}

// Deterministic "heads up" insights — computed, not AI-generated, so they're
// instant, free, and reliable. Each may carry an `ask`: a natural-language
// prompt the user can hand straight to the assistant to act on it.
// Returned most-urgent first, capped by the caller.
export function computeInsights(
  transactions = [],
  budgets = [],
  categories = [],
  { today = new Date().toISOString().slice(0, 10) } = {}
) {
  const month = monthKey(today)
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()
  const daysLeft = Math.max(0, daysInMonth - Number(today.slice(8, 10)))

  const monthTx = transactions.filter((t) => monthKey(t.date) === month)
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const spentByCat = new Map()
  for (const t of monthTx) {
    if (t.kind !== 'expense' || !t.category_id) continue
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + Number(t.amount))
  }

  const insights = []
  for (const b of budgets) {
    const spent = spentByCat.get(b.category_id) ?? 0
    const amount = Number(b.amount) || 0
    if (amount <= 0) continue
    const name = nameById.get(b.category_id) ?? 'a category'
    const pct = spent / amount
    if (spent > amount) {
      insights.push({
        severity: 3,
        tone: 'bad',
        text: `${name} is $${money(spent - amount)} over its $${money(amount)} budget.`,
        ask: `Increase my ${name} budget`,
      })
    } else if (pct >= 0.9 && daysLeft > 2) {
      insights.push({
        severity: 2,
        tone: 'warn',
        text: `You've used ${Math.round(pct * 100)}% of your ${name} budget with ${daysLeft} days to go.`,
        ask: `How much do I have left for ${name}?`,
      })
    }
  }

  // A single unusually large expense this month.
  const expenses = monthTx.filter((t) => t.kind === 'expense')
  const totalExpense = sum(expenses)
  if (expenses.length >= 4 && totalExpense > 0) {
    const biggest = expenses.reduce((a, t) => (Number(t.amount) > Number(a.amount) ? t : a))
    if (Number(biggest.amount) > totalExpense * 0.4) {
      insights.push({
        severity: 1,
        tone: 'info',
        text: `${biggest.note || biggest.category?.name || 'One purchase'} ($${money(
          biggest.amount
        )}) is your biggest expense this month.`,
      })
    }
  }

  return insights.sort((a, b) => b.severity - a.severity)
}

// A once-a-week "here's how your week went" digest, computed from the trailing
// 7 days vs the 7 before that. The in-app retention hook.
export function computeWeeklySummary(transactions = [], { today = new Date().toISOString().slice(0, 10) } = {}) {
  const weekStart = addDays(today, -6) // inclusive 7-day window ending today
  const prevStart = addDays(today, -13)
  const prevEnd = addDays(today, -7)

  const inRange = (d, start, end) => d >= start && d <= end
  const thisWeek = transactions.filter((t) => inRange(t.date, weekStart, today))
  const prevWeek = transactions.filter((t) => inRange(t.date, prevStart, prevEnd))

  const spend = sum(thisWeek.filter((t) => t.kind === 'expense'))
  const prevSpend = sum(prevWeek.filter((t) => t.kind === 'expense'))
  const income = sum(thisWeek.filter((t) => t.kind === 'income'))
  const net = income - spend

  // Top spending category this week.
  const byCat = new Map()
  for (const t of thisWeek) {
    if (t.kind !== 'expense') continue
    const name = t.category?.name ?? 'Uncategorized'
    byCat.set(name, (byCat.get(name) ?? 0) + Number(t.amount))
  }
  let topCategory = null
  let topAmount = 0
  for (const [name, amt] of byCat) {
    if (amt > topAmount) {
      topAmount = amt
      topCategory = name
    }
  }

  const delta = prevSpend > 0 ? (spend - prevSpend) / prevSpend : null
  return {
    weekStart,
    today,
    spend,
    prevSpend,
    delta, // fraction change vs last week, or null if no baseline
    income,
    net,
    topCategory,
    topAmount,
    count: thisWeek.length,
    hasData: thisWeek.length > 0,
  }
}

const DINING_RE = /dining|restaurant|takeout|take-out|fast food|coffee|cafe/i
const GROCERY_RE = /grocer/i

// The money+health story no pure-budgeting app can tell: how much of your food
// spending goes to eating out, alongside what you actually logged eating.
export function computeFoodMoney(
  transactions = [],
  foodLogs = [],
  { today = new Date().toISOString().slice(0, 10) } = {}
) {
  const month = monthKey(today)
  const monthTx = transactions.filter((t) => monthKey(t.date) === month && t.kind === 'expense')

  let diningSpend = 0
  let grocerySpend = 0
  for (const t of monthTx) {
    const name = t.category?.name ?? ''
    if (DINING_RE.test(name)) diningSpend += Number(t.amount)
    else if (GROCERY_RE.test(name)) grocerySpend += Number(t.amount)
  }
  const foodSpend = diningSpend + grocerySpend
  const eatingOutShare = foodSpend > 0 ? diningSpend / foodSpend : null

  const monthLogs = foodLogs.filter((l) => monthKey(l.date) === month)
  let loggedCalories = 0
  let loggedCost = 0
  for (const l of monthLogs) {
    const s = Number(l.servings) || 1
    loggedCalories += Number(l.calories || 0) * s
    loggedCost += Number(l.cost || 0) * s
  }

  return {
    month,
    diningSpend,
    grocerySpend,
    foodSpend,
    eatingOutShare,
    loggedCalories,
    loggedCost,
    mealsLogged: monthLogs.length,
    hasData: foodSpend > 0 || monthLogs.length > 0,
  }
}
