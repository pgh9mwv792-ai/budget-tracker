// Signed-out marketing page. No router in this app by design — App renders this
// (or Login) in the signed-out branch. `onGetStarted` opens sign-up; `onSignIn`
// opens the sign-in view. Copy register: plain verbs, sentence case, specific.
// No invented testimonials, no fake user counts.

const FEATURES = [
  {
    title: 'See what your food actually costs',
    body: 'Track meals and macros like any tracker — but each food carries its real price, so you get cost per 100g of protein and your cheapest protein ranked automatically.',
  },
  {
    title: 'Automatic bank import and budgets',
    body: 'Link a bank or credit card and transactions import and categorize themselves. Set monthly budgets per category and watch spending against them.',
  },
  {
    title: 'An AI assistant that does the work',
    body: 'Ask questions in plain language — "how much did I spend eating out?" — or tell it to add a transaction, set a budget, or log a meal. It reads your data and makes the change.',
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

function ScreenshotPlaceholder({ label }) {
  return (
    <div className="aspect-video w-full rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center">
      {/* SCREENSHOT: {label} — 16:9, drop the product screenshot here */}
      <span className="text-xs text-slate-400 dark:text-slate-500">{label}</span>
    </div>
  )
}

export default function Landing({ onGetStarted, onSignIn }) {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top bar */}
      <header className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
          Budget Tracker
        </div>
        <button
          onClick={onSignIn}
          className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
        >
          Sign in
        </button>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-10 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
          Macro tracking that knows what your food actually costs.
        </h1>
        <p className="mt-5 text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
          Most trackers count calories. This one connects your meals to your real transactions, so you see
          cost per gram of protein, where your food money goes, and the whole budget around it.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 text-sm font-semibold transition"
          >
            Get started free
          </button>
          <button
            onClick={onSignIn}
            className="rounded-md border border-slate-300 dark:border-slate-700 px-6 py-3 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Sign in
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Free to start. No ads, ever.</p>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 pb-20 space-y-16">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            className={`grid md:grid-cols-2 gap-8 items-center ${i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}`}
          >
            <div>
              <h2 className="text-2xl font-semibold">{f.title}</h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300">{f.body}</p>
            </div>
            <ScreenshotPlaceholder label={f.title} />
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section className="bg-slate-50 dark:bg-slate-900/40 border-y border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl font-semibold text-center">Simple pricing</h2>
          <p className="mt-2 text-center text-slate-600 dark:text-slate-300">
            Everything you need to track spending and meals is free. Pay only for automation.
          </p>
          <div className="mt-10 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <h3 className="font-semibold">Free</h3>
              <p className="mt-1 text-3xl font-bold">
                $0<span className="text-base font-normal text-slate-500 dark:text-slate-400">/mo</span>
              </p>
              <ul className="mt-5 space-y-2">
                {FREE.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={onGetStarted}
                className="mt-6 w-full rounded-md border border-slate-300 dark:border-slate-700 py-2.5 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Get started free
              </button>
            </div>
            <div className="rounded-2xl border-2 border-emerald-500 bg-white dark:bg-slate-900 p-6">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Pro</h3>
                <span className="text-xs rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 px-2 py-0.5">
                  Automation
                </span>
              </div>
              <p className="mt-1 text-3xl font-bold">
                $6<span className="text-base font-normal text-slate-500 dark:text-slate-400">/mo</span>
              </p>
              <ul className="mt-5 space-y-2">
                {PRO.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={onGetStarted}
                className="mt-6 w-full rounded-md bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 text-sm font-semibold transition"
              >
                Start free, upgrade anytime
              </button>
              <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">Cancel anytime.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / security */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-semibold text-center">Built to hold financial data</h2>
        <div className="mt-10 grid sm:grid-cols-2 gap-6">
          {TRUST.map((t) => (
            <div key={t.title} className="rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <h3 className="font-semibold">{t.title}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Read the full{' '}
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-700 dark:hover:text-slate-200"
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
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 text-sm font-semibold transition"
        >
          Get started free
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            Budget Tracker
          </div>
          <div className="flex items-center gap-5">
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-700 dark:hover:text-slate-200 underline"
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
