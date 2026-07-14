import { estimateProteinCosts } from '../lib/foodCost'

// Signed-out marketing page. No router in this app by design — App renders this
// (or Login) in the signed-out branch. `onGetStarted` opens sign-up; `onSignIn`
// opens the sign-in view. Copy register: plain verbs, sentence case, specific.
// No invented testimonials, no fake user counts.

const FEATURES = [
  {
    title: 'See what your food actually costs',
    body: 'Log meals like any tracker — but every food carries its real price, so you get cost per gram of protein and your cheapest protein, ranked automatically.',
    Visual: FoodCostMini,
  },
  {
    title: 'Stop hand-entering transactions',
    body: 'Link a bank or card and transactions import and categorize themselves. No more typing in every coffee run.',
    Visual: TransactionsMock,
  },
  {
    title: 'Catch overspending before month-end',
    body: 'Set a monthly budget per category and watch each one fill up as you spend.',
    Visual: BudgetMock,
  },
  {
    title: 'Just ask instead of digging',
    body: 'Ask in plain language, or tell it to add a transaction, set a budget, or log a meal — it reads your data and makes the change.',
    Visual: AssistantMock,
  },
]

const FREE = [
  'Manual transactions, budgets, and savings goals',
  'Receipt scanning',
  'Meal and macro tracker with food costs',
  'Credit-score log and card utilization',
  'Data export and account deletion',
]

const PRO = [
  'Automatic bank & credit-card import (Plaid)',
  'The AI assistant — answers questions and makes changes',
  'Everything in Free',
]

const TRUST = [
  {
    title: 'Bank tokens encrypted at rest',
    body: 'The token that connects your bank is stored encrypted with AES-GCM. Bank credentials are handled by Plaid and never touch our servers.',
  },
  {
    title: 'Your data is walled off per account',
    body: 'Every table uses row-level security, so the database itself only ever returns your own rows — not just the app UI.',
  },
  {
    title: 'Two-factor authentication',
    body: 'Turn on TOTP two-factor from Settings for a second layer beyond your password.',
  },
  {
    title: 'You can leave with your data',
    body: 'Export everything to JSON or CSV anytime, and delete your account and all its data permanently in one click.',
  },
]

// A real, ranked cost-per-protein table computed from estimateProteinCosts —
// the app's central idea shown with concrete numbers before you sign up. Bars
// are relative to the priciest example so the cheap-vs-expensive gap is visible.
function ProteinCostExample() {
  const ranked = estimateProteinCosts()
  const max = Math.max(...ranked.map((r) => r.costPerPortion))
  return (
    <section className="max-w-3xl mx-auto px-4 pb-20">
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-2xl font-semibold text-center">What does 30g of protein cost you?</h2>
        <p className="mt-2 text-center text-text-muted text-sm">
          Same protein, wildly different prices. This is the ranking the app builds automatically from
          your own foods — here are a few common ones to start.
        </p>
        <ul className="mt-6 space-y-2.5">
          {ranked.map((r) => (
            <li key={r.name} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-sm text-text">
                {r.name}
                <span className="block text-xs text-text-muted">{r.unit}</span>
              </span>
              <span className="flex-1 h-6 rounded bg-bg overflow-hidden">
                <span
                  className="block h-full bg-primary/80 rounded"
                  style={{ width: `${Math.max(8, (r.costPerPortion / max) * 100)}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-text">
                ${r.costPerPortion.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-center text-xs text-text-muted">
          Cost per 30g of protein. Example grocery prices — your numbers come from what you actually buy.
        </p>
      </div>
    </section>
  )
}

// Blurred, non-interactive mock-ups of the two Pro features, each behind a lock
// badge. They convey "there's more here" without shipping a fake screenshot or
// promising data we don't have. Clicking a card starts the free sign-up.
function ProPreviews({ onGetStarted }) {
  return (
    <section className="max-w-5xl mx-auto px-4 pb-20">
      <h2 className="text-2xl font-semibold text-center">Upgrade to automate the busywork</h2>
      <p className="mt-2 text-center text-text-muted">
        Free does everything by hand. Pro connects your bank and adds the assistant.
      </p>
      <div className="mt-10 grid sm:grid-cols-2 gap-6">
        <PreviewCard
          title="Automatic bank import"
          blurb="Transactions flow in and categorize themselves — which also powers subscription and recurring-bill tracking."
          onGetStarted={onGetStarted}
        >
          <MockRows />
        </PreviewCard>
        <PreviewCard
          title="The AI assistant"
          blurb="Ask questions in plain language or tell it to log a meal, add a transaction, or set a budget — it makes the change."
          onGetStarted={onGetStarted}
        >
          <MockChat />
        </PreviewCard>
      </div>
    </section>
  )
}

function PreviewCard({ title, blurb, children, onGetStarted }) {
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="relative h-40 bg-bg border-b border-border">
        {/* The mock content is blurred + dimmed so it reads as "preview". */}
        <div className="absolute inset-0 p-4 blur-[3px] opacity-60 select-none pointer-events-none" aria-hidden>
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary text-on-primary text-xs font-semibold px-3 py-1 shadow">
            <span aria-hidden>🔒</span> Pro
          </span>
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-text-muted">{blurb}</p>
        <button
          onClick={onGetStarted}
          className="mt-4 text-sm font-semibold text-interactive hover:underline"
        >
          Start free →
        </button>
      </div>
    </div>
  )
}

function MockRows() {
  const rows = [
    ['Whole Foods Market', '-$82.40', 'Groceries'],
    ['Netflix', '-$15.99', 'Entertainment'],
    ['Shell Gas', '-$44.00', 'Transportation'],
    ['Payroll', '+$3,200.00', 'Salary'],
  ]
  return (
    <div className="space-y-2">
      {rows.map(([name, amt, cat]) => (
        <div key={name} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs">
          <span className="font-medium text-text">{name}</span>
          <span className="text-text-muted">{cat}</span>
          <span className="font-semibold text-text">{amt}</span>
        </div>
      ))}
    </div>
  )
}

function MockChat() {
  return (
    <div className="space-y-2">
      <div className="ml-auto max-w-[80%] rounded-2xl bg-primary text-on-primary px-3 py-2 text-xs">
        how much did I spend eating out this month?
      </div>
      <div className="max-w-[85%] rounded-2xl bg-surface border border-border px-3 py-2 text-xs text-text">
        You’ve spent $312 on restaurants so far — 55% of your food spending.
      </div>
    </div>
  )
}

// Honest, first-person "why I built this." No invented press, awards, or user
// counts — just the reason it exists. Update the copy freely; keep it truthful.
function FounderStory() {
  return (
    <section className="max-w-3xl mx-auto px-4 pb-20">
      <div className="rounded-2xl border border-border p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">Why I built this</h2>
        <div className="mt-4 space-y-3 text-text-muted leading-relaxed">
          <p>
            I wanted to eat more protein without wrecking my budget, and none of the apps I tried could
            answer a simple question: what is my food actually costing me per gram of protein? Calorie
            trackers ignore money; budgeting apps ignore what you eat.
          </p>
          <p>
            So I built the tool I wanted — one place where my transactions and my meals live together, so
            I can see the cheapest protein I already buy, where my food money goes, and whether hitting my
            goal is affordable. It’s free to use by hand; the paid tier just automates the parts I got
            tired of doing myself.
          </p>
        </div>
      </div>
    </section>
  )
}

// Feature-row visuals. Each renders a cropped slice of the real product UI with
// realistic sample data and makes exactly one point. All use design tokens only
// (no hardcoded hues) so they read correctly in both light and dark themes, and
// share the card radius/border of the buttons and cards around them.

// Money formatter shared by the transaction and budget visuals.
const usd = (n) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Food cost → the app's core idea, cropped to just the cheapest-protein ranking.
function FoodCostMini() {
  const cheapest = estimateProteinCosts().slice(0, 3)
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-text-muted">
        Cheapest protein · $ per 30g
      </div>
      <ul className="p-3 space-y-2">
        {cheapest.map((r, i) => (
          <li key={r.name} className="flex items-center gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-interactive">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-sm text-text">
              {r.name}
              <span className="block text-xs text-text-muted">{r.unit}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
              ${usd(r.costPerPortion)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Bank import → imported rows that categorized themselves; green income / red
// expense via the semantic tokens, category as a chip.
function TransactionsMock() {
  const rows = [
    ["Trader Joe's", -64.18, 'Groceries'],
    ['Chipotle', -12.85, 'Dining out'],
    ['Shell', -41.2, 'Gas'],
    ['Paycheck', 2480, 'Income'],
  ]
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-text-muted">
        Imported today · auto-categorized
      </div>
      {rows.map(([name, amt, cat]) => (
        <div
          key={name}
          className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text">{name}</div>
            <span className="mt-0.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-interactive">
              {cat}
            </span>
          </div>
          <span
            className={`shrink-0 text-sm font-semibold tabular-nums ${amt >= 0 ? 'text-success' : 'text-danger'}`}
          >
            {amt >= 0 ? '+' : '−'}${usd(Math.abs(amt))}
          </span>
        </div>
      ))}
    </div>
  )
}

// Budget → a progress card mid-month: one healthy category, one near its limit.
function BudgetMock() {
  const budgets = [
    { name: 'Groceries', spent: 312, limit: 450 },
    { name: 'Dining out', spent: 178, limit: 200 },
  ]
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-surface p-4 space-y-4">
      {budgets.map((b) => {
        const pct = b.spent / b.limit
        const bar = pct >= 1 ? 'bg-danger' : pct >= 0.85 ? 'bg-warning' : 'bg-success'
        return (
          <div key={b.name}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-text">{b.name}</span>
              <span className="tabular-nums text-text-muted">
                <span className="font-semibold text-text">${usd(b.spent)}</span> of ${usd(b.limit)}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg">
              <div
                className={`h-full rounded-full ${bar}`}
                style={{ width: `${Math.min(100, pct * 100)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// AI assistant → told to do something, it makes the change and reports back.
function AssistantMock() {
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-surface p-4 space-y-2.5">
      <div className="ml-auto max-w-[80%] rounded-2xl bg-primary px-3 py-2 text-sm text-on-primary">
        add $60 groceries from today
      </div>
      <div className="max-w-[88%] rounded-2xl border border-border bg-bg px-3 py-2 text-sm text-text">
        Added a $60 Groceries expense for today. Your grocery budget is now $372 of $450.
      </div>
    </div>
  )
}

export default function Landing({ onGetStarted, onSignIn, onExploreDemo }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Top bar */}
      <header className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" />
          Budget Tracker
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onSignIn}
            className="text-sm font-medium text-text-muted hover:text-text"
          >
            Sign in
          </button>
          <button
            onClick={onGetStarted}
            className="rounded-md bg-primary hover:bg-primary-hover text-on-primary px-4 py-2 text-sm font-semibold transition"
          >
            Get started free
          </button>
        </div>
      </header>

      {/* Hero + the concrete cost-per-protein example share a soft entry glow
          that fades from a light brand tint down into the page background,
          easing the eye from the hero visual into the following section. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-primary-tint/50 to-transparent"
        />

        {/* Hero */}
        <section className="max-w-5xl mx-auto px-4 pt-10 pb-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
            Macro tracking that knows what your food actually costs.
          </h1>
          <p className="mt-5 text-lg text-text-muted max-w-2xl mx-auto">
            Most trackers count calories. This one connects your meals to your real transactions, so you see
            cost per gram of protein, where your food money goes, and the whole budget around it.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={onGetStarted}
              className="rounded-md bg-primary hover:bg-primary-hover text-on-primary px-6 py-3 text-sm font-semibold transition"
            >
              Get started free <span aria-hidden="true">→</span>
            </button>
            <button
              onClick={onSignIn}
              className="rounded-md border border-border px-6 py-3 text-sm font-semibold hover:bg-primary-tint transition"
            >
              Sign in
            </button>
          </div>
          {onExploreDemo && (
            <button
              onClick={onExploreDemo}
              className="mt-4 text-sm font-semibold text-interactive hover:underline"
            >
              Explore with sample data — no account needed →
            </button>
          )}
          <p className="mt-3 text-xs text-text-muted">Free to start. No ads, ever.</p>
        </section>

        {/* Cost-per-protein example — the core idea, made concrete with real numbers */}
        <ProteinCostExample />
      </div>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 pb-20 space-y-16">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            className={`grid md:grid-cols-2 gap-8 items-center ${i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}`}
          >
            <div>
              <h2 className="text-2xl font-semibold">{f.title}</h2>
              <p className="mt-3 text-text-muted">{f.body}</p>
            </div>
            <f.Visual />
          </div>
        ))}
      </section>

      {/* What Pro unlocks — blurred previews behind a lock, honest about the gate */}
      <ProPreviews onGetStarted={onGetStarted} />

      {/* Founder story — why this exists, in plain first person. No fake press. */}
      <FounderStory />

      {/* A short ramp from the page background up into the pricing band, so the
          deliberate bg-surface break (kept below via border-y) reads as
          intentional rather than an abrupt line. */}
      <div aria-hidden className="h-6 bg-gradient-to-b from-bg to-surface" />

      {/* Pricing */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl font-semibold text-center">Simple pricing</h2>
          <p className="mt-2 text-center text-text-muted">
            Everything you need to track spending and meals is free. Pay only for automation.
          </p>
          <div className="mt-10 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <div className="rounded-2xl border border-border bg-surface p-6">
              <h3 className="font-semibold">Free</h3>
              <p className="mt-1 text-3xl font-bold">
                $0<span className="text-base font-normal text-text-muted">/mo</span>
              </p>
              <ul className="mt-5 space-y-2">
                {FREE.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-text">
                    <span className="text-interactive">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={onGetStarted}
                className="mt-6 w-full rounded-md border border-border py-2.5 text-sm font-semibold hover:bg-primary-tint transition"
              >
                Get started free
              </button>
            </div>
            <div className="rounded-2xl border-2 border-primary bg-surface p-6">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Pro</h3>
                <span className="text-xs rounded-full bg-primary/10 text-interactive px-2 py-0.5">
                  Automation
                </span>
              </div>
              <p className="mt-1 text-3xl font-bold">
                $6<span className="text-base font-normal text-text-muted">/mo</span>
              </p>
              <ul className="mt-5 space-y-2">
                {PRO.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-text">
                    <span className="text-interactive">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={onGetStarted}
                className="mt-6 w-full rounded-md bg-primary hover:bg-primary-hover text-on-primary py-2.5 text-sm font-semibold transition"
              >
                Start free, upgrade anytime
              </button>
              <p className="mt-2 text-center text-xs text-text-muted">Cancel anytime.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / security */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-semibold text-center">Built to hold financial data</h2>
        <div className="mt-10 grid sm:grid-cols-2 gap-6">
          {TRUST.map((t) => (
            <div key={t.title} className="rounded-xl border border-border p-5">
              <h3 className="font-semibold">{t.title}</h3>
              <p className="mt-2 text-sm text-text-muted">{t.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-text-muted">
          Read the full{' '}
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-text"
          >
            privacy policy
          </a>
          .
        </p>
      </section>

      {/* Final CTA */}
      <section className="max-w-5xl mx-auto px-4 pb-20 text-center">
        <button
          onClick={onGetStarted}
          className="rounded-md bg-primary hover:bg-primary-hover text-on-primary px-6 py-3 text-sm font-semibold transition"
        >
          Get started free <span aria-hidden="true">→</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-text-muted">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-primary" />
            Budget Tracker
          </div>
          <div className="flex items-center gap-5">
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text underline"
            >
              Privacy
            </a>
            {/* CONTACT: replace with a real support address before launch */}
            <span>Contact: support@example.com</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
