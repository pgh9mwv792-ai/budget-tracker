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
import { monthKey, monthLabel, trailingMonthKeys, todayISO } from '../lib/dateHelpers'
import { detectRecurring } from '../lib/analysis'
import { computeMonthOutlook, computeInsights, computeWeeklySummary } from '../lib/forecast'
import { computeFoodCost } from '../lib/foodCost'
import { useIsMobile } from '../lib/useMediaQuery'
import { useTheme } from '../contexts/ThemeContext'
import { useThemeColors } from '../lib/colors'
import ShareCard from './ShareCard'

// Currency formatting for every chart label/axis/tooltip, so nothing ever
// renders raw float arithmetic like "400000000000006".
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const usd = (n) => USD.format(Number(n) || 0)
const usdCompact = (n) => USD_COMPACT.format(Number(n) || 0)

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
  const currentMonth = monthKey(todayISO())
  const isMobile = useIsMobile()
  // Chart colors come from the CSS design tokens (index.css), re-read on every
  // theme change so Recharts recolors when the user toggles light/dark.
  const { theme } = useTheme()
  const colors = useThemeColors(theme)

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

  // Sum each category in integer cents, then convert back to dollars once, so a
  // month of expenses can't accumulate binary-float drift (the source of the
  // "$400000000000006" label). Zero-value categories are dropped.
  const categoryBreakdown = useMemo(() => {
    const cents = new Map()
    for (const t of currentMonthTx) {
      if (t.kind !== 'expense') continue
      const name = t.category?.name ?? 'Uncategorized'
      cents.set(name, (cents.get(name) ?? 0) + Math.round(Number(t.amount) * 100))
    }
    return [...cents.entries()]
      .map(([name, c]) => ({ name, value: c / 100 }))
      .filter((e) => e.value > 0)
  }, [currentMonthTx])

  // Slices actually drawn: the top 5 spending categories on the navy ramp, the
  // long tail folded into a single "Other" slice, and Uncategorized always on
  // its own muted-gray slice (never the navy ramp, so it reads as "needs a
  // category" rather than a real bucket).
  const pieData = useMemo(() => {
    const UNCAT = 'Uncategorized'
    const ramp = [colors.cat1, colors.cat2, colors.cat3, colors.cat4, colors.cat5]
    const uncat = categoryBreakdown.find((e) => e.name === UNCAT) || null
    const named = categoryBreakdown.filter((e) => e.name !== UNCAT).sort((a, b) => b.value - a.value)
    const slices = named.slice(0, 5).map((e, i) => ({ ...e, color: ramp[i] }))
    const rest = named.slice(5)
    if (rest.length > 0) {
      const otherVal = Math.round(rest.reduce((s, e) => s + e.value, 0) * 100) / 100
      if (otherVal > 0) slices.push({ name: 'Other', value: otherVal, color: colors.cat6 })
    }
    if (uncat) slices.push({ name: UNCAT, value: uncat.value, color: colors.textMuted })
    return slices
  }, [categoryBreakdown, colors])

  const rollingIncome = useMemo(() => {
    const keys = trailingMonthKeys(3)
    return keys.map((key) => {
      const monthTotal = sum(transactions.filter((t) => t.kind === 'income' && monthKey(t.date) === key))
      return { month: monthLabel(key), income: monthTotal }
    })
  }, [transactions])

  const rollingAverage =
    rollingIncome.length > 0 ? rollingIncome.reduce((acc, m) => acc + m.income, 0) / rollingIncome.length : 0
  // Below a cent of income across the whole window, a bar chart just scales its
  // axis to noise — show a helpful empty state instead.
  const hasIncome = rollingIncome.some((m) => m.income >= 0.01)

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
        <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Spending by category (this month)</h3>
          {pieData.length === 0 ? (
            <p className="text-sm text-text-muted">No expenses recorded this month yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 280 : 260}>
              <PieChart>
                {/* No outside labels or callout lines — the dollar value for each
                    slice lives in the legend and tooltip instead, which keeps the
                    chart readable at every width. */}
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={isMobile ? 70 : 90}
                  label={false}
                  labelLine={false}
                  isAnimationActive={false}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, name) => [usd(v), name]} />
                <Legend
                  verticalAlign="bottom"
                  wrapperStyle={{ fontSize: isMobile ? 11 : 12 }}
                  formatter={(value, entry) => `${value} — ${usd(entry?.payload?.value)}`}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-text mb-1">Trailing 3-month average income</h3>
          <p className="text-2xl font-semibold text-text mb-3">{usd(rollingAverage)}</p>
          {hasIncome ? (
            <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
              <BarChart data={rollingIncome} margin={isMobile ? { top: 8, right: 4, bottom: 0, left: -12 } : undefined}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                <XAxis dataKey="month" tick={{ fontSize: isMobile ? 11 : 12, fill: 'currentColor' }} className="text-text-muted" />
                <YAxis tickFormatter={usdCompact} tick={{ fontSize: isMobile ? 11 : 12, fill: 'currentColor' }} tickCount={isMobile ? 4 : 6} width={isMobile ? 48 : 64} className="text-text-muted" />
                <Tooltip formatter={(v) => [usd(v), 'Income']} />
                <Bar dataKey="income" fill={colors.interactive} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center text-center rounded-lg border border-dashed border-border bg-bg/50" style={{ height: isMobile ? 180 : 200 }}>
              <p className="text-sm text-text-muted px-6">
                No income recorded yet — categorize deposits as Income (or add an income transaction) to see your
                trailing average here.
              </p>
            </div>
          )}
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
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Accounts</h3>
        {depository.length > 0 && (
          <span className="text-xs text-text-muted">
            Cash on hand:{' '}
            <span className="font-semibold text-text">{fmt(cash)}</span>
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
            <div key={a.account_id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  {label(a)}
                </span>
                {a.mask && <span className="text-xs text-text-muted">••{a.mask}</span>}
              </div>
              <p className="text-sm text-text-muted truncate" title={a.name || 'Account'}>
                {a.name || 'Account'}
              </p>
              <p className={`text-xl font-semibold mt-1 ${owed ? 'text-danger' : 'text-text'}`}>
                {fmt(a.current_balance)}
              </p>
              {isCredit ? (
                <>
                  <p className="text-xs text-text-muted">
                    {owed ? 'owed' : ' '}
                    {limit > 0 && ` · limit ${fmt(limit)}`}
                  </p>
                  {util != null && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-text-muted">Utilization</span>
                        <span className={util > 30 ? 'text-warning font-medium' : 'text-text-muted'}>
                          {util}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className={`h-full rounded-full ${util > 30 ? 'bg-warning' : 'bg-success'}`}
                          style={{ width: `${Math.min(100, util)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-text-muted">
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
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden>💬</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell your budget what happened…"
            className="w-full rounded-full border border-border bg-surface text-text pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-interactive/40"
          />
        </div>
        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded-full bg-primary hover:bg-primary-hover text-on-primary text-sm px-5 font-medium transition disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => submit(ex)}
            className="text-xs rounded-full border border-border text-text-muted px-2.5 py-1 hover:bg-primary-tint transition"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}

const INSIGHT_TONE = {
  bad: 'border-danger/30 bg-danger/10 text-danger',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-primary/30 bg-primary/10 text-interactive',
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
    <div className="relative rounded-2xl border border-primary/30 bg-primary-tint shadow-sm p-5 sm:p-6">
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss digest"
          className="absolute top-3 right-3 text-text-muted hover:text-text text-lg leading-none px-1"
        >
          ×
        </button>
      )}
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        <span className="inline-block w-2 h-2 rounded-full bg-interactive" />
        Weekly digest{weekOf ? ` · week of ${weekOf}` : ''}
      </div>
      <p className="mt-2 text-lg font-semibold text-text pr-6">{digest.subject}</p>
      <div className="mt-2 space-y-2 text-sm text-text-muted leading-relaxed">
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
      ? { text: `${Math.round(weekly.delta * 100)}% more than last week`, cls: 'text-danger' }
      : weekly.delta < -0.05
      ? { text: `${Math.round(Math.abs(weekly.delta) * 100)}% less than last week`, cls: 'text-success' }
      : { text: 'about the same as last week', cls: 'text-text-muted' }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <h3 className="text-sm font-semibold text-text mb-1">Your week</h3>
      <p className="text-2xl font-semibold text-text">${weekly.spend.toFixed(2)}</p>
      <p className="text-xs text-text-muted">spent in the last 7 days</p>
      {trend && <p className={`mt-1 text-sm font-medium ${trend.cls}`}>{trend.text}</p>}
      <div className="mt-3 space-y-1 text-sm text-text-muted">
        {weekly.topCategory && (
          <p>
            Most went to <b className="text-text">{weekly.topCategory}</b> (${weekly.topAmount.toFixed(2)})
          </p>
        )}
        <p>
          Net this week:{' '}
          <b className={weekly.net >= 0 ? 'text-success' : 'text-danger'}>
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
      ? { text: `${Math.round(burn.delta * 100)}% above your 3-month average`, cls: 'text-warning' }
      : burn.delta < -0.05
      ? { text: `${Math.round(Math.abs(burn.delta) * 100)}% below your 3-month average`, cls: 'text-interactive' }
      : { text: 'right around your 3-month average', cls: 'text-text-muted' }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/10 shadow-sm p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-primary" />
          Food &amp; money
        </div>
        {shareCards.length > 0 && (
          <button
            onClick={() => setSharing(true)}
            title="Share this"
            aria-label="Share this"
            className="inline-flex items-center gap-1 text-xs font-medium text-interactive hover:underline"
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
          <p className="text-lg font-semibold text-text">See what your food really costs</p>
          <p className="mt-1 text-sm text-text-muted">
            Log a few meals with their cost, and tag grocery/restaurant spending, to unlock your cost per day and
            cost per 100g of protein right here.
          </p>
          {onNavigate && (
            <button
              onClick={() => onNavigate('Meals')}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline"
            >
              Start logging meals →
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <span className="text-4xl sm:text-5xl font-bold tracking-tight text-interactive">
                {spend.hasData ? dollars(spend.perDay) : '—'}
              </span>
              <span className="ml-2 text-sm text-text-muted">/ day on food</span>
              <p className="text-xs text-text-muted mt-0.5">last {spend.days} days</p>
            </div>
            <div>
              <span className="text-2xl sm:text-3xl font-semibold text-text">
                {protein.hasData ? dollars(protein.costPer100g) : '—'}
              </span>
              <span className="ml-2 text-sm text-text-muted">/ 100g protein</span>
              <p className="text-xs text-text-muted mt-0.5">
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
              <div className="flex justify-between text-xs text-text-muted mb-1">
                <span>Eating out {dollars(spend.restaurant)}</span>
                <span>Groceries {dollars(spend.grocery)}</span>
              </div>
              <div className="h-2 rounded-full bg-border overflow-hidden flex">
                <div className="bg-danger" style={{ width: `${restPct}%` }} />
                <div className="bg-primary" style={{ width: `${100 - restPct}%` }} />
              </div>
              <p className="mt-2 text-sm text-text-muted">
                <b className="text-text">{restPct}%</b> of your food spending was eating out.
              </p>
            </div>
          )}

          {bulk && (
            <p className="mt-3 text-sm text-text-muted">
              Hitting your {Math.round(bulk.proteinTarget)}g protein goal every day runs about{' '}
              <b className="text-text">{dollars(bulk.monthlyCost)}/mo</b>
              {bulk.source === 'library' ? ' at your cheapest food' : ''}.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
            {burn.spentSoFar > 0 && (
              <span>
                This month so far <b className="text-text">{dollars(burn.spentSoFar)}</b>
              </span>
            )}
            {burn.average != null && (
              <span>
                Projected <b className="text-text">{dollars(burn.projected)}</b>
                {burnTrend && <span className={`ml-1 ${burnTrend.cls}`}>· {burnTrend.text}</span>}
              </span>
            )}
          </div>

          {onNavigate && (
            <button
              onClick={() => onNavigate('Meals')}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline"
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
      date: todayISO(),
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
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-text">Cheapest protein in your library</h3>
        {efficiency.coverage != null && efficiency.priced < efficiency.total && (
          <span className="text-xs text-text-muted">
            {efficiency.priced} of {efficiency.total} foods priced
          </span>
        )}
      </div>
      <p className="text-xs text-text-muted mb-3">Ranked by cost per 30g of protein.</p>
      <div className="divide-y divide-border">
        {top.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-text">
                {f.name}
                {f.serving_desc && <span className="text-text-muted"> · {f.serving_desc}</span>}
              </p>
              <p className="text-xs text-text-muted">
                ${f.costPer30g.toFixed(2)} / 30g P · {Math.round(f.protein)}g P for ${f.cost.toFixed(2)}
              </p>
            </div>
            {onLogFood && (
              <button
                onClick={() => logOne(f)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-interactive hover:bg-primary-tint transition"
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
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline"
        >
          Manage foods →
        </button>
      )}
    </div>
  )
}

const TONE = {
  good: {
    card: 'border-success/30 bg-success/10',
    number: 'text-success',
    dot: 'bg-success',
  },
  warn: {
    card: 'border-warning/30 bg-warning/10',
    number: 'text-warning',
    dot: 'bg-warning',
  },
  bad: {
    card: 'border-danger/30 bg-danger/10',
    number: 'text-danger',
    dot: 'bg-danger',
  },
  neutral: {
    card: 'border-border bg-surface',
    number: 'text-text',
    dot: 'bg-text-muted',
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
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} />
        This month · {monthLabel(outlook.month)}
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
        {showNumber && <span className={`text-4xl sm:text-5xl font-bold tracking-tight ${tone.number}`}>{signed}</span>}
        <span className="text-sm text-text-muted mb-1.5">{outlook.primary.label}</span>
      </div>

      <p className="mt-2 text-lg font-semibold text-text">{outlook.verdict.headline}</p>
      <p className="text-sm text-text-muted">{outlook.verdict.sub}</p>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
        <span>Spent <b className="text-text">${outlook.spent.toFixed(2)}</b></span>
        <span>Income <b className="text-text">${outlook.income.toFixed(2)}</b></span>
        {outlook.hasBudget && (
          <span>Budget <b className="text-text">${outlook.budgetTotal.toFixed(2)}</b></span>
        )}
        <span><b className="text-text">{outlook.daysLeft}</b> days left</span>
      </div>

      {outlook.upcoming.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs font-semibold text-text-muted mb-2">Still expected before month-end</p>
          <div className="space-y-1.5">
            {outlook.upcoming.slice(0, 5).map((r) => (
              <div key={r.key} className="flex items-center justify-between text-sm">
                <span className="truncate text-text-muted">{r.label}</span>
                <span className="shrink-0 ml-3 tabular-nums">
                  <span className={r.kind === 'income' ? 'text-success' : r.kind === 'transfer' ? 'text-text-muted' : 'text-text'}>
                    {r.kind === 'income' ? '+' : r.kind === 'transfer' ? '⇄ ' : '-'}${r.amount.toFixed(2)}
                  </span>
                  <span className="text-xs text-text-muted ml-2">{r.nextDate.slice(5)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!outlook.hasBudget && onNavigate && (
        <button
          onClick={() => onNavigate('Budgets')}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline"
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
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-text">Recurring &amp; upcoming</h3>
        {onNavigate && (
          <button
            onClick={() => onNavigate('Transactions')}
            className="shrink-0 text-xs font-medium text-interactive hover:underline"
          >
            View all subscriptions →
          </button>
        )}
      </div>
      <p className="text-xs text-text-muted mb-3">
        Detected from repeating transactions — next date is an estimate.
      </p>
      <div className="divide-y divide-border">
        {items.map((r) => (
          <div key={r.key} className="flex items-center justify-between py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-text">{r.label}</p>
              <p className="text-xs text-text-muted">
                {r.cadence} · seen {r.count}×
              </p>
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className={`font-medium ${r.kind === 'income' ? 'text-success' : r.kind === 'transfer' ? 'text-text-muted' : 'text-danger'}`}>
                {r.kind === 'income' ? '+' : r.kind === 'transfer' ? '⇄ ' : '-'}${r.amount.toFixed(2)}
              </p>
              <p className={`text-xs ${r.overdue ? 'text-warning' : 'text-text-muted'}`}>
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
  const toneClass = tone === 'emerald' ? 'text-success' : 'text-danger'
  // (tone prop values kept as 'emerald'/'red' for callers; they map to the
  // success/danger semantic tokens here.)
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <p className="text-sm text-text-muted">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>${value.toFixed(2)}</p>
    </div>
  )
}
