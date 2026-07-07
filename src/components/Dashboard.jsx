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
import { computeMonthOutlook, computeInsights, computeWeeklySummary } from '../lib/forecast'
import { computeFoodCost } from '../lib/foodCost'
import { useIsMobile } from '../lib/useMediaQuery'
import ShareCard from './ShareCard'

const COLORS = ['#0f172a', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#84cc16', '#06b6d4']

export default function Dashboard({
  transactions,
  budgets = [],
  categories = [],
  foods = [],
  foodLogs = [],
  nutritionTargets = null,
  accounts = [],
  digest = null,
  displayName = '',
  onDismissDigest,
  onNavigate,
  onAsk,
  onLogFood,
}) {
  const currentMonth = monthKey(new Date().toISOString())
  const isMobile = useIsMobile()

  const outlook = useMemo(() => computeMonthOutlook(transactions, budgets), [transactions, budgets])
  const insights = useMemo(
    () => computeInsights(transactions, budgets, categories).slice(0, 3),
    [transactions, budgets, categories]
  )
  const weekly = useMemo(() => computeWeeklySummary(transactions), [transactions])
  const foodCost = useMemo(
    () => computeFoodCost({ transactions, foodLogs, foods, nutritionTargets }),
    [transactions, foodLogs, foods, nutritionTargets]
  )

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
      {digest && <DigestCard digest={digest} onDismiss={onDismissDigest} />}

      {onAsk && <QuickAsk onAsk={onAsk} />}

      <FoodMoneyHero food={foodCost} onNavigate={onNavigate} displayName={displayName} />

      {foodCost.efficiency.hasData && (
        <ProteinValueCard efficiency={foodCost.efficiency} onLogFood={onLogFood} onNavigate={onNavigate} />
      )}

      <VerdictCard outlook={outlook} onNavigate={onNavigate} />

      {accounts.length > 0 && <AccountsPanel accounts={accounts} />}

      {insights.length > 0 && <InsightsStrip insights={insights} onAsk={onAsk} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Income (this month)" value={totalIncome} tone="emerald" />
        <StatCard label="Expenses (this month)" value={totalExpenses} tone="red" />
        <StatCard label="Net" value={net} tone={net >= 0 ? 'emerald' : 'red'} />
      </div>

      {weekly.hasData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WeeklyCard weekly={weekly} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Spending by category (this month)</h3>
          {categoryBreakdown.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No expenses recorded this month yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 280 : 260}>
              <PieChart>
                {/* On mobile, drop the slice labels (they overlap at 375px) and
                    rely on the legend below the chart instead. */}
                <Pie
                  data={categoryBreakdown}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={isMobile ? 70 : 90}
                  label={!isMobile}
                >
                  {categoryBreakdown.map((entry, i) => (
                    <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: isMobile ? 11 : 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Trailing 3-month average income</h3>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-3">${rollingAverage.toFixed(2)}</p>
          <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
            <BarChart data={rollingIncome} margin={isMobile ? { top: 8, right: 4, bottom: 0, left: -12 } : undefined}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
              <XAxis dataKey="month" tick={{ fontSize: isMobile ? 11 : 12, fill: 'currentColor' }} className="text-slate-500 dark:text-slate-400" />
              <YAxis tick={{ fontSize: isMobile ? 11 : 12, fill: 'currentColor' }} tickCount={isMobile ? 4 : 6} width={isMobile ? 44 : 60} className="text-slate-500 dark:text-slate-400" />
              <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
              <Bar dataKey="income" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <RecurringPanel items={recurring} onNavigate={onNavigate} />
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
          const isCredit = a.type === 'credit'
          const owed = isCredit || a.type === 'loan'
          const limit = Number(a.credit_limit)
          const bal = Number(a.current_balance)
          const util = isCredit && limit > 0 ? Math.round((bal / limit) * 100) : null
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
              {isCredit ? (
                <>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {owed ? 'owed' : ' '}
                    {limit > 0 && ` · limit ${fmt(limit)}`}
                  </p>
                  {util != null && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-slate-500 dark:text-slate-400">Utilization</span>
                        <span className={util > 30 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                          {util}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${util > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, util)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {owed
                    ? 'owed'
                    : a.available_balance != null && Number(a.available_balance) !== Number(a.current_balance)
                      ? `${fmt(a.available_balance)} available`
                      : ' '}
                </p>
              )}
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

// The proactive weekly digest, mirrored in-app as a dismissible card at the top
// of the Dashboard. `summary` is the friendly recap the email uses; we split it
// into paragraphs on blank lines. Dismissing persists via digests.dismissed.
function DigestCard({ digest, onDismiss }) {
  const paragraphs = (digest.summary || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const weekOf = digest.week_start
    ? new Date(`${digest.week_start}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="relative rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20 shadow-sm p-5 sm:p-6">
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss digest"
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none px-1"
        >
          ×
        </button>
      )}
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
        Weekly digest{weekOf ? ` · week of ${weekOf}` : ''}
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100 pr-6">{digest.subject}</p>
      <div className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p>{digest.summary}</p>
        )}
      </div>
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

// Money + food, front and center — the lead of the whole dashboard and the
// story pure-budgeting apps can't tell. Shows what you spend on food per day,
// how cheaply you're buying protein, and where the money goes (grocery vs.
// eating out). Renders a compact "unlock this" fallback when data is thin so
// it's never a broken empty state.
// Build the shareable card specs for the food/money moments, mirroring the
// hero's own logic: cost per 100g protein, and either the "bulk" projection
// (when nutrition targets exist) or plain monthly food spend. Every string here
// is privacy-safe — a headline stat only, no balances/banks/transactions.
function buildFoodShareCards(food) {
  const { spend, protein, burn, bulk } = food
  const money2 = (n) => `$${Number(n || 0).toFixed(2)}`
  const moneyWhole = (n) => `$${Math.round(Number(n || 0)).toLocaleString('en-US')}`
  const cards = []

  if (protein?.hasData && protein.costPer100g != null) {
    cards.push({
      id: 'protein',
      label: 'Protein cost',
      eyebrow: 'Cost per 100g protein',
      stat: money2(protein.costPer100g),
      caption: 'from my logged meals this month',
    })
  }

  if (bulk) {
    cards.push({
      id: 'bulk',
      label: 'Protein / mo',
      eyebrow: 'My daily protein goal',
      stat: `${moneyWhole(bulk.monthlyCost)}/mo`,
      caption: `Hitting ${Math.round(bulk.proteinTarget)}g of protein a day${
        bulk.source === 'library' ? ' at my cheapest food' : ''
      }`,
    })
  } else {
    const monthly =
      burn?.average != null && burn.average > 0
        ? burn.average
        : burn?.spentSoFar > 0
        ? burn.projected
        : spend?.hasData
        ? spend.perDay * 30
        : null
    if (monthly != null && monthly > 0) {
      cards.push({
        id: 'food-cost',
        label: 'Food / mo',
        eyebrow: 'What I spend on food',
        stat: `${moneyWhole(monthly)}/mo`,
        caption: 'tracked automatically from real transactions',
      })
    }
  }

  return cards
}

function FoodMoneyHero({ food, onNavigate, displayName = '' }) {
  const { spend, protein, burn, bulk } = food
  const dollars = (n) => `$${Number(n || 0).toFixed(2)}`
  const [sharing, setSharing] = useState(false)
  const shareCards = food.hasData ? buildFoodShareCards(food) : []
  const firstName = displayName.trim().split(/\s+/)[0] || ''

  // Grocery vs. restaurant split (of the two — "other" food sits in the total).
  const splitBase = spend.grocery + spend.restaurant
  const restPct = splitBase > 0 ? Math.round((spend.restaurant / splitBase) * 100) : null

  const burnTrend =
    burn.delta == null
      ? null
      : burn.delta > 0.05
      ? { text: `${Math.round(burn.delta * 100)}% above your 3-month average`, cls: 'text-amber-600 dark:text-amber-400' }
      : burn.delta < -0.05
      ? { text: `${Math.round(Math.abs(burn.delta) * 100)}% below your 3-month average`, cls: 'text-emerald-600 dark:text-emerald-400' }
      : { text: 'right around your 3-month average', cls: 'text-slate-500 dark:text-slate-400' }

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 shadow-sm p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          Food &amp; money
        </div>
        {shareCards.length > 0 && (
          <button
            onClick={() => setSharing(true)}
            title="Share this"
            aria-label="Share this"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
              <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
            </svg>
            Share
          </button>
        )}
      </div>

      {sharing && shareCards.length > 0 && (
        <ShareCard cards={shareCards} firstName={firstName} onClose={() => setSharing(false)} />
      )}

      {!food.hasData ? (
        <div className="mt-2">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">See what your food really costs</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Log a few meals with their cost, and tag grocery/restaurant spending, to unlock your cost per day and
            cost per 100g of protein right here.
          </p>
          {onNavigate && (
            <button
              onClick={() => onNavigate('Meals')}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              Start logging meals →
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <span className="text-4xl sm:text-5xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
                {spend.hasData ? dollars(spend.perDay) : '—'}
              </span>
              <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">/ day on food</span>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">last {spend.days} days</p>
            </div>
            <div>
              <span className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {protein.hasData ? dollars(protein.costPer100g) : '—'}
              </span>
              <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">/ 100g protein</span>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                {protein.hasData
                  ? protein.coverage != null && protein.coverage < 0.999
                    ? `based on ${Math.round(protein.coverage * 100)}% of meals with a cost`
                    : 'from your logged meals'
                  : 'log meal costs to see this'}
              </p>
            </div>
          </div>

          {restPct != null && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>Eating out {dollars(spend.restaurant)}</span>
                <span>Groceries {dollars(spend.grocery)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                <div className="bg-amber-500" style={{ width: `${restPct}%` }} />
                <div className="bg-emerald-500" style={{ width: `${100 - restPct}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <b className="text-slate-800 dark:text-slate-100">{restPct}%</b> of your food spending was eating out.
              </p>
            </div>
          )}

          {bulk && (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              Hitting your {Math.round(bulk.proteinTarget)}g protein goal every day runs about{' '}
              <b className="text-slate-800 dark:text-slate-100">{dollars(bulk.monthlyCost)}/mo</b>
              {bulk.source === 'library' ? ' at your cheapest food' : ''}.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {burn.spentSoFar > 0 && (
              <span>
                This month so far <b className="text-slate-700 dark:text-slate-200">{dollars(burn.spentSoFar)}</b>
              </span>
            )}
            {burn.average != null && (
              <span>
                Projected <b className="text-slate-700 dark:text-slate-200">{dollars(burn.projected)}</b>
                {burnTrend && <span className={`ml-1 ${burnTrend.cls}`}>· {burnTrend.text}</span>}
              </span>
            )}
          </div>

          {onNavigate && (
            <button
              onClick={() => onNavigate('Meals')}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              Open meal tracker →
            </button>
          )}
        </>
      )}
    </div>
  )
}

// The "cheapest protein you already own" ranking, straight from the food
// library. Each row logs one serving to today with a single tap, reusing the
// same food-log flow as the Meals tab.
function ProteinValueCard({ efficiency, onLogFood, onNavigate }) {
  const [loggedId, setLoggedId] = useState(null)
  const top = efficiency.ranked.slice(0, 5)

  const logOne = async (food) => {
    if (!onLogFood) return
    await onLogFood({
      date: new Date().toISOString().slice(0, 10),
      meal: 'snack',
      foodId: food.id,
      name: food.name,
      servings: 1,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      cost: food.cost,
    })
    setLoggedId(food.id)
    setTimeout(() => setLoggedId((cur) => (cur === food.id ? null : cur)), 2000)
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cheapest protein in your library</h3>
        {efficiency.coverage != null && efficiency.priced < efficiency.total && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {efficiency.priced} of {efficiency.total} foods priced
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Ranked by cost per 30g of protein.</p>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {top.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-slate-700 dark:text-slate-200">
                {f.name}
                {f.serving_desc && <span className="text-slate-400 dark:text-slate-500"> · {f.serving_desc}</span>}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                ${f.costPer30g.toFixed(2)} / 30g P · {Math.round(f.protein)}g P for ${f.cost.toFixed(2)}
              </p>
            </div>
            {onLogFood && (
              <button
                onClick={() => logOne(f)}
                className="shrink-0 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
              >
                {loggedId === f.id ? 'Logged ✓' : 'Log this'}
              </button>
            )}
          </div>
        ))}
      </div>
      {onNavigate && (
        <button
          onClick={() => onNavigate('Meals')}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-600 dark:text-sky-400 hover:underline"
        >
          Manage foods →
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

function RecurringPanel({ items, onNavigate }) {
  if (items.length === 0) return null
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Recurring &amp; upcoming</h3>
        {onNavigate && (
          <button
            onClick={() => onNavigate('Transactions')}
            className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            View all subscriptions →
          </button>
        )}
      </div>
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
