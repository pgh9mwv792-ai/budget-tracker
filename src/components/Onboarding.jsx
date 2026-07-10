import { useState } from 'react'

// First-run guided setup. Shown once to brand-new users (no transactions yet and
// no `onboarded` flag on their account). Goal: get them to a first "oh, cool"
// moment in well under two minutes, then get out of the way.
//
// Props:
//   onFinish(): mark onboarding complete (persist flag + hide).
//   onNavigate(tab): jump to a tab (and the parent closes onboarding).
//   onLoadSample(): populate a few example transactions so the dashboard fills
//     in immediately. Returns a promise.
//   onScanReceipt(): jump to the Transactions tab AND focus the receipt scanner
//     (the receipt-first primary path). Falls back to onNavigate('Transactions').
export default function Onboarding({ onFinish, onNavigate, onLoadSample, onScanReceipt }) {
  const [step, setStep] = useState(0)
  const [loadingSample, setLoadingSample] = useState(false)

  const go = (tab) => {
    onNavigate(tab)
    onFinish()
  }

  const goScanReceipt = () => {
    if (onScanReceipt) onScanReceipt()
    else onNavigate('Transactions')
    onFinish()
  }

  const handleSample = async () => {
    setLoadingSample(true)
    try {
      await onLoadSample()
      onFinish()
    } finally {
      setLoadingSample(false)
    }
  }

  const steps = [
    {
      emoji: '🍗',
      title: 'See what your food really costs',
      body: 'Budget Tracker connects your spending to what you actually eat — cost per day on food, cost per gram of protein, and groceries vs. eating out — alongside the rest of your money. Plus an assistant that does the busywork for you.',
      actions: (
        <PrimaryButton onClick={() => setStep(1)}>Get started</PrimaryButton>
      ),
    },
    {
      emoji: '🧾',
      title: 'Start with a receipt',
      body: 'The fastest way in: snap a photo of a grocery or restaurant receipt. It reads the total and every line item, so your spending — and the foods you bought — land in one step. No typing.',
      actions: (
        <div className="w-full space-y-2">
          <PrimaryButton onClick={goScanReceipt}>Scan a receipt</PrimaryButton>
          <SecondaryButton onClick={() => setStep(2)}>Other ways to start</SecondaryButton>
        </div>
      ),
    },
    {
      emoji: '💸',
      title: 'Other ways to start',
      body: 'Prefer not to scan? Connect a bank to import automatically, add a few transactions by hand, or load sample data (including a few logged meals) to explore the food-cost dashboard right away.',
      actions: (
        <div className="w-full space-y-2">
          <PrimaryButton onClick={() => go('Transactions')}>Connect a bank (auto-import)</PrimaryButton>
          <SecondaryButton onClick={() => go('Transactions')}>I’ll add transactions myself</SecondaryButton>
          <SecondaryButton onClick={handleSample} disabled={loadingSample}>
            {loadingSample ? 'Loading examples…' : 'Load sample data to explore'}
          </SecondaryButton>
        </div>
      ),
    },
    {
      emoji: '💬',
      title: 'Meet your assistant',
      body: 'Tap the chat button any time and just say what happened — “spent $40 on groceries”, “set a $300 dining budget”, “how am I doing this month?” It updates the app for you.',
      actions: <PrimaryButton onClick={onFinish}>Start using the app</PrimaryButton>,
    },
  ]

  const current = steps[step]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6 sm:p-8">
        <div className="text-4xl mb-3" aria-hidden>{current.emoji}</div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{current.title}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{current.body}</p>

        <div className="mt-6">{current.actions}</div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition ${
                  i === step ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>
          <button
            onClick={onFinish}
            className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}

function PrimaryButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 transition"
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-700 dark:text-slate-200 text-sm font-medium py-2.5 transition"
    >
      {children}
    </button>
  )
}
