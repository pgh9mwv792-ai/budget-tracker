import { useMemo, useState, lazy, Suspense } from 'react'
import NavBar from './NavBar'
import Subscriptions from './Subscriptions'
import { buildDemoData } from '../lib/demoData'

// Signed-out "Explore with sample data" experience. Renders the real app
// components against an in-memory sample month (src/lib/demoData.js) so a visitor
// sees a fully-populated dashboard — the money+food hero, subscriptions, meals,
// and the micronutrient section — WITHOUT an account. Nothing here ever touches
// Supabase: every mutation handler updates local React state only, and the
// network-backed actions (USDA search, barcode lookup) are inert stubs.
//
// A persistent banner makes the demo unmistakable and routes to sign-up. `onExit`
// returns to the landing page; `onSignUp` opens the sign-up form.
const Dashboard = lazy(() => import('./Dashboard'))
const TransactionList = lazy(() => import('./TransactionList'))
const BudgetManager = lazy(() => import('./BudgetManager'))
const MealTracker = lazy(() => import('./MealTracker'))

// Tabs that carry sample data worth exploring. The rest of the real nav
// (Credit, Goals, Categories, Settings) would be empty or account-bound, so the
// demo redirects those back to the Dashboard rather than showing blank pages.
const DEMO_TABS = new Set(['Dashboard', 'Transactions', 'Budgets', 'Meals'])

let demoLogSeq = 0
const nextDemoId = (prefix) => `${prefix}-live-${demoLogSeq++}`

export default function DemoMode({ onExit, onSignUp }) {
  // Built once per mount so exploring (logging a meal, editing a budget) sticks
  // for the session but resets cleanly the next time the demo opens.
  const initial = useMemo(() => buildDemoData(), [])
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [transactions, setTransactions] = useState(initial.transactions)
  const [foods, setFoods] = useState(initial.foods)
  const [foodLogs, setFoodLogs] = useState(initial.foodLogs)
  const [budgets, setBudgets] = useState(initial.budgets)
  const [nutritionTargets, setNutritionTargets] = useState(initial.nutritionTargets)
  const { categories } = initial

  const goTab = (tab) => setActiveTab(DEMO_TABS.has(tab) ? tab : 'Dashboard')

  // Local-only handlers: they keep the demo interactive without any DB write.
  const addFood = (values) => {
    const food = {
      id: nextDemoId('demo-food'),
      name: values.name,
      serving_desc: values.servingDesc || null,
      calories: values.calories || 0,
      protein: values.protein || 0,
      carbs: values.carbs || 0,
      fat: values.fat || 0,
      cost: values.cost === '' || values.cost == null ? null : values.cost,
      fdc_id: values.fdcId || null,
      nutrients: values.nutrients ?? null,
      source: values.source || 'manual',
      source_ref: values.sourceRef || null,
      aliases: values.aliases || [],
      brand: values.brand || null,
      is_stack: !!values.isStack,
      grade: values.grade || null,
      upc: values.upc || null,
    }
    setFoods((prev) => [...prev, food].sort((a, b) => a.name.localeCompare(b.name)))
    return food
  }
  const logFood = (values) => {
    const log = {
      id: nextDemoId('demo-log'),
      food_id: values.foodId || null,
      date: values.date,
      meal: values.meal ?? null,
      name: values.name,
      servings: values.servings || 1,
      calories: values.calories || 0,
      protein: values.protein || 0,
      carbs: values.carbs || 0,
      fat: values.fat || 0,
      cost: values.cost == null ? null : values.cost,
      transaction_id: values.transactionId || null,
    }
    setFoodLogs((prev) => [log, ...prev])
    return log
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <DemoBanner onExit={onExit} onSignUp={onSignUp} />

      <NavBar
        activeTab={activeTab}
        onTabChange={goTab}
        userName="Sample account"
        onSignOut={onExit}
      />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 pb-[calc(4rem+env(safe-area-inset-bottom)+1.5rem)] md:pb-6">
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'Dashboard' && (
            <Dashboard
              transactions={transactions}
              budgets={budgets}
              categories={categories}
              foods={foods}
              foodLogs={foodLogs}
              nutritionTargets={nutritionTargets}
              accounts={[]}
              displayName="there"
              onNavigate={goTab}
              onAsk={() => onSignUp()}
              onLogFood={logFood}
            />
          )}

          {activeTab === 'Transactions' && (
            <>
              <Subscriptions transactions={transactions} />
              <TransactionList
                transactions={transactions}
                categories={categories}
                receiptsByTransaction={new Map()}
                onCreate={(values) =>
                  setTransactions((prev) => [
                    {
                      id: nextDemoId('demo-tx'),
                      ...values,
                      category_id: values.categoryId || null,
                      category: categories.find((c) => c.id === values.categoryId) ?? null,
                    },
                    ...prev,
                  ])
                }
                onUpdate={(id, updates) =>
                  setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
                }
                onDelete={(id) => setTransactions((prev) => prev.filter((t) => t.id !== id))}
              />
            </>
          )}

          {activeTab === 'Budgets' && (
            <BudgetManager
              categories={categories}
              budgets={budgets}
              transactions={transactions}
              onSetBudget={(categoryId, amount) =>
                setBudgets((prev) => [
                  ...prev.filter((b) => b.category_id !== categoryId),
                  { id: nextDemoId('demo-budget'), category_id: categoryId, amount },
                ])
              }
              onRemoveBudget={(categoryId) =>
                setBudgets((prev) => prev.filter((b) => b.category_id !== categoryId))
              }
            />
          )}

          {activeTab === 'Meals' && (
            <MealTracker
              foods={foods}
              logs={foodLogs}
              targets={nutritionTargets}
              transactions={transactions}
              onAddFood={addFood}
              onUpdateFood={(id, updates) =>
                setFoods((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)))
              }
              onDeleteFood={(id) => setFoods((prev) => prev.filter((f) => f.id !== id))}
              onLogFood={logFood}
              onUpdateLog={(id, updates) =>
                setFoodLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)))
              }
              onDeleteLog={(id) => setFoodLogs((prev) => prev.filter((l) => l.id !== id))}
              onSetTargets={(values) => setNutritionTargets((prev) => ({ ...prev, ...values }))}
              onSearchFoods={async () => []}
              onFoodDetails={async () => null}
              onBarcodeLookup={async () => ({ found: false })}
            />
          )}
        </Suspense>
      </main>
    </div>
  )
}

function DemoBanner({ onExit, onSignUp }) {
  return (
    <div className="sticky top-0 z-40 bg-emerald-600 text-white">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          Demo — sample data, nothing is saved.{' '}
          <span className="hidden sm:inline font-normal text-emerald-100">
            Sign up to start tracking your own.
          </span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onExit}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/60 transition"
          >
            Exit demo
          </button>
          <button
            onClick={onSignUp}
            className="rounded-md bg-white text-emerald-700 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-50 transition"
          >
            Sign up free
          </button>
        </div>
      </div>
    </div>
  )
}

function TabSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-32 rounded-xl bg-slate-200 dark:bg-slate-800" />
      <div className="h-48 rounded-xl bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}
