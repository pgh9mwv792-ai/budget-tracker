import { useMemo, useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { monthKey, monthLabel, trailingMonthKeys } from '../lib/dateHelpers'
import { detectRecurring } from '../lib/analysis'
import { computeMonthOutlook, computeInsights, computeWeeklySummary, computeFoodMoney } from '../lib/forecast'

const COLORS = ['#0f172a', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#84cc16', '#06b6d4']

export default function Dashboard({
  transactions,
  budgets = [],
  categories = [],
  foodLogs = [],
  accounts = [],
  onNavigate,
  onAsk,
}) {
  const currentMonth = monthKey(new Date().toISOString())

  const outlook = useMemo(() => computeMonthOutlook(transactions, budgets), [transactions, budgets])
  const insights = useMemo(
    () => computeInsights(transactions, budgets, categories).slice(0, 3),
    [transactions, budgets, categories]
  )
  const weekly = useMemo(() => computeWeeklySummary(transactions), [transactions])
  const foodMoney = useMemo(() => computeFoodMoney(transactions, foodLogs), [transactions, foodLogs])

  const currentMonthTx = useMemo(
    () => transactions.filter((t) => monthKey(t.date) === currentMonth),
    [transactions, currentMonth]
  )

  const totalIncome = sum(currentMonthTx.filter((t) => t.kind === 'income'))
  const totalExpenses = sum(currentMonthTx.filter((t) => t.kind === 'expense'))
  const net = totalIncome - totalExpenses

  const categoryBreakdown = useMemo(() => {
    const byCategory = new Map()
    for (const t of currentMonthTx) {
      if (t.kind !== 'expense') continue
      const name = t.category?.name ?? 'Uncategorized'
      byCategory.set(name, (byCategory.get(name) ?? 0) + Number(t.amount))
    }
    return [...byCategory.entries()].map(([name, value]) => ({ name, value }))
  }, [currentMonthTx])

  const rollingIncome = useMemo(() => {
    const keys = trailingMonthKeys(3)
    return keys.map((key) => {
      const monthTotal = sum(transactions.filter((t) => t.kind === 'income' && monthKey(t.date) === key))
      return { month: monthLabel(key), income: monthTotal }
    })
  }, [transactions])

  const rollingAverage =
    rollingIncome.length > 0 ? rollingIncome.reduce((acc, m) => acc + m.income, 0) / rollingIncome.length : 0

  const recurring = useMemo(() => detectRecurring(transactions).slice(0, 6), [transactions])

  return (
    <div className="space-y-6">
      {onAsk && <QuickAsk onAsk={onAsk} />}

      <VerdictCard outlook={outlook} onNavigate={onNavigate} />

      {accounts.length > 0 && <AccountsPanel accounts={accounts} />}

      {insights.length > 0 && <InsightsStrip insights={insights} onAsk={onAsk} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Income (this month)" value={totalIncome} tone="emerald" />
        <StatCard label="Expenses (this month)" value={totalExpenses} tone="red" />
        <StatCard label="Net" value={net} tone={net >= 0 ? 'emerald' : 'red'} />
      </div>

      {(weekly.hasData || foodMoney.hasData) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {weekly.hasData && <WeeklyCard weekly={weekly} />}
          {foodMoney.hasData && <FoodMoneyCard food={foodMoney} onNavigate={onNavigate} />}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Spending by category (this month)</h3>
          {categoryBreakdown.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No expenses recorded this month yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={categoryBreakdown} dataKey="value" nameKey="name" outerRadius={90} label>
                  {categoryBreakdown.map((entry, i) => (
                    <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Trailing 3-month average income</h3>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-3">${rollingAverage.toFixed(2)}</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rollingIncome}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'currentColor' }} className="text-slate-500 dark:text-slate-400" />
              <YAxis tick={{ fontSize: 12, fill: 'currentColor' }} className="text-slate-500 dark:text-slate-400" />
              <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
              <Bar dataKey="income" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <RecurringPanel items={recurring} />
    </div>
  )
}

// Shows each linked bank account (checking, savings, credit card…) with its
// balance, so the user sees checking and savings separately at a glance.
function AccountsPanel({ accounts }) {
  const fmt = (n) =>
    n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const label = (a) => {
    const s = (a.subtype || a.type || 'account').replace(/_/g, ' ')
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  // "Cash on hand" = spendable money = checking + savings (depository accounts).
  // Credit-card and loan balances are money owed, so they're excluded.
  const depository = accounts.filter((a) => a.type === 'depository')
  const cash = depository.reduce((sum, a) => sum + (Number(a.current_balance) || 0), 0)

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Accounts</h3>
        {depository.length > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Cash on hand:{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmt(cash)}</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a) => {
          const owed = a.type === 'credit' || a.type === 'loan'
          return (
            <div key={a.account_id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {label(a)}
                </span>
                {a.mask && <span className="text-xs text-slate-400 dark:text-slate-500">••{a.mask}</span>}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 truncate" title={a.name || 'Account'}>
                {a.name || 'Account'}
              </p>
              <p className={`text-xl font-semibold mt-1 ${owed ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {fmt(a.current_balance)}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {owed
                  ? 'owed'
                  : a.available_balance != null && Number(a.available_balance) !== Number(a.current_balance)
                    ? `${fmt(a.available_balance)} available`
                    : ' '}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Natural-language entry point at the top of the app. Hands whatever the user
// types straight to the assistant, which can answer or make the change.
function QuickAsk({ onAsk }) {
  const [text, setText] = useState('')
  const EXAMPLES = ['spent $40 on groceries', 'how am I doing this month?', 'set a $300 dining budget']

  const submit = (value) => {
    const v = value.trim()
    if (!v) return
    onAsk(v)
    setText('')
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>💬</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell your budget what happened…"
            className="w-full rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-5 font-medium transition disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => submit(ex)}
            className="text-xs rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}

const INSIGHT_TONE = {
  bad: 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 text-red-800 dark:text-red-300',
  warn: 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300',
  info: 'border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/20 text-sky-800 dark:text-sky-300',
}

// Proactive "heads up" nudges. Each can offer a one-tap hand-off to the assistant.
function InsightsStrip({ insights, onAsk }) {
  return (
    <div className="space-y-2">
      {insights.map((it, i) => (
        <div
          key={i}
          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
            INSIGHT_TONE[it.tone] ?? INSIGHT_TONE.info
          }`}
        >
          <span>{it.text}</span>
          {it.ask && onAsk && (
            <button
              onClick={() => onAsk(it.ask)}
              className="shrink-0 text-xs font-medium underline underline-offset-2 hover:no-underline"
            >
              {it.ask} →
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// Weekly digest — the in-app retention hook.
function WeeklyCard({ weekly }) {
  const trend =
    weekly.delta == null
      ? null
      : weekly.delta > 0.05
      ? { text: `${Math.round(weekly.delta * 100)}% more than last week`, cls: 'text-red-600 dark:text-red-400' }
      : weekly.delta < -0.05
      ? { text: `${Math.round(Math.abs(weekly.delta) * 100)}% less than last week`, cls: 'text-emerald-600 dark:text-emerald-400' }
      : { text: 'about the same as last week', cls: 'text-slate-500 dark:text-slate-400' }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Your week</h3>
      <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">${weekly.spend.toFixed(2)}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">spent in the last 7 days</p>
      {trend && <p className={`mt-1 text-sm font-medium ${trend.cls}`}>{trend.text}</p>}
      <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        {weekly.topCategory && (
          <p>
            Most went to <b className="text-slate-800 dark:text-slate-100">{weekly.topCategory}</b> (${weekly.topAmount.toFixed(2)})
          </p>
        )}
        <p>
          Net this week:{' '}
          <b className={weekly.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
            {weekly.net >= 0 ? '+' : '-'}${Math.abs(weekly.net).toFixed(2)}
          </b>
        </p>
      </div>
    </div>
  )
}

// Money + health, side by side — the story pure-budgeting apps can't tell.
function FoodMoneyCard({ food, onNavigate }) {
  const sharePct = food.eatingOutShare == null ? null : Math.round(food.eatingOutShare * 100)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Food &amp; money (this month)</h3>
      {food.foodSpend > 0 ? (
        <>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">${food.foodSpend.toFixed(2)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">on food total</p>
          {sharePct != null && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>Eating out ${food.diningSpend.toFixed(0)}</span>
                <span>Groceries ${food.grocerySpend.toFixed(0)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                <div className="bg-amber-500" style={{ width: `${sharePct}%` }} />
                <div className="bg-emerald-500" style={{ width: `${100 - sharePct}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <b className="text-slate-800 dark:text-slate-100">{sharePct}%</b> of your food spending was eating out.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Log meals and tag food spending to see the link.</p>
      )}
      {food.mealsLogged > 0 && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          {food.mealsLogged} meals logged · {Math.round(food.loggedCalories).toLocaleString()} cal
        </p>
      )}
      {onNavigate && (
        <button
          onClick={() => onNavigate('Meals')}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-600 dark:text-sky-400 hover:underline"
        >
          Open meal tracker →
        </button>
      )}
    </div>
  )
}

const TONE = {
  good: {
    card: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20',
    number: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  warn: {
    card: 'border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20',
    number: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  bad: {
    card: 'border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/20',
    number: 'text-red-600 dark:text-red-400',
    dot: 'bg-red-500',
  },
  neutral: {
    card: 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
    number: 'text-slate-700 dark:text-slate-200',
    dot: 'bg-slate-400',
  },
}

// The "am I okay?" hero. One big number, one plain-language verdict, and the
// bills still hanging over the rest of the month — the first thing a user
// should see on open.
function VerdictCard({ outlook, onNavigate }) {
  const tone = TONE[outlook.verdict.tone] ?? TONE.neutral
  const amount = outlook.primary.amount
  const signed = `${amount < 0 ? '-' : ''}$${Math.abs(Math.round(amount)).toLocaleString()}`
  const showNumber = !(outlook.verdict.tone === 'neutral' && amount === 0)

  return (
    <div className={`rounded-2xl border shadow-sm p-5 sm:p-6 ${tone.card}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} />
        This month · {monthLabel(outlook.month)}
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
        {showNumber && <span className={`text-4xl sm:text-5xl font-bold tracking-tight ${tone.number}`}>{signed}</span>}
        <span className="text-sm text-slate-500 dark:text-slate-400 mb-1.5">{outlook.primary.label}</span>
      </div>

      <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{outlook.verdict.headline}</p>
      <p className="text-sm text-slate-600 dark:text-slate-300">{outlook.verdict.sub}</p>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>Spent <b className="text-slate-700 dark:text-slate-200">${outlook.spent.toFixed(2)}</b></span>
        <span>Income <b className="text-slate-700 dark:text-slate-200">${outlook.income.toFixed(2)}</b></span>
        {outlook.hasBudget && (
          <span>Budget <b className="text-slate-700 dark:text-slate-200">${outlook.budgetTotal.toFixed(2)}</b></span>
        )}
        <span><b className="text-slate-700 dark:text-slate-200">{outlook.daysLeft}</b> days left</span>
      </div>

      {outlook.upcoming.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200/70 dark:border-slate-700/50">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Still expected before month-end</p>
          <div className="space-y-1.5">
            {outlook.upcoming.slice(0, 5).map((r) => (
              <div key={r.key} className="flex items-center justify-between text-sm">
                <span className="truncate text-slate-600 dark:text-slate-300">{r.label}</span>
                <span className="shrink-0 ml-3 tabular-nums">
                  <span className={r.kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : r.kind === 'transfer' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-200'}>
                    {r.kind === 'income' ? '+' : r.kind === 'transfer' ? '⇄ ' : '-'}${r.amount.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{r.nextDate.slice(5)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!outlook.hasBudget && onNavigate && (
        <button
          onClick={() => onNavigate('Budgets')}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-sky-600 dark:text-sky-400 hover:underline"
        >
          Set a budget for a clearer number →
        </button>
      )}
    </div>
  )
}

function RecurringPanel({ items }) {
  if (items.length === 0) return null
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Recurring &amp; upcoming</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Detected from repeating transactions — next date is an estimate.
      </p>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((r) => (
          <div key={r.key} className="flex items-center justify-between py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-slate-700 dark:text-slate-200">{r.label}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {r.cadence} · seen {r.count}×
              </p>
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className={`font-medium ${r.kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : r.kind === 'transfer' ? 'text-slate-500 dark:text-slate-400' : 'text-red-600 dark:text-red-400'}`}>
                {r.kind === 'income' ? '+' : r.kind === 'transfer' ? '⇄ ' : '-'}${r.amount.toFixed(2)}
              </p>
              <p className={`text-xs ${r.overdue ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
                {r.overdue ? 'expected by ' : 'next ~ '}
                {r.nextDate}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function sum(txs) {
  return txs.reduce((acc, t) => acc + Number(t.amount), 0)
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>${value.toFixed(2)}</p>
    </div>
  )
}
