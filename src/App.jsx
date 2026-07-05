import { useEffect, useState, useCallback, useRef } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import Login from './components/Login'
import MfaChallenge from './components/MfaChallenge'
import Settings from './components/Settings'
import NavBar from './components/NavBar'
import Dashboard from './components/Dashboard'
import TransactionList from './components/TransactionList'
import UncategorizedBucket from './components/UncategorizedBucket'
import GoalTracker from './components/GoalTracker'
import CategoryManager from './components/CategoryManager'
import BudgetManager from './components/BudgetManager'
import MealTracker from './components/MealTracker'
import ChatWidget from './components/ChatWidget'
import PlaidLinkButton from './components/PlaidLinkButton'
import ReceiptScanner from './components/ReceiptScanner'
import Onboarding from './components/Onboarding'
import * as api from './lib/api'
import { supabase } from './lib/supabaseClient'
import { merchantKey, matchRules } from './lib/analysis'
import { addDays } from './lib/dateHelpers'

function AppShell() {
  const { user, loading, needsMfa, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [goals, setGoals] = useState([])
  const [budgets, setBudgets] = useState([])
  const [rules, setRules] = useState([])
  const [foods, setFoods] = useState([])
  const [foodLogs, setFoodLogs] = useState([])
  const [nutritionTargets, setNutritionTargets] = useState(null)
  const [memories, setMemories] = useState([])
  const [plaidAccounts, setPlaidAccounts] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  const [onboardDismissed, setOnboardDismissed] = useState(false)
  // A prompt handed to the assistant from elsewhere (e.g. the Dashboard quick-ask
  // bar or an insight nudge). ChatWidget opens and sends it, then clears it.
  const [assistantPrompt, setAssistantPrompt] = useState(null)
  // Tracks whether we've done the very first data load. Supabase fires auth
  // events on token refresh AND on window focus change — opening the Plaid
  // popup triggers one. Without this guard, every such event flipped
  // dataLoading back to true, which unmounted the whole app (including the
  // open Plaid Link window), making the bank popup "just close". We now only
  // show the full-screen loader once, and never tear the tree down on refetch.
  const hasLoadedOnce = useRef(false)

  // Depend on user?.id, not the whole user object: a token refresh produces a
  // brand-new user object with the same id, and we don't want that to rebuild
  // loadAll (which would re-trigger the effect below and remount everything).
  const loadAll = useCallback(async () => {
    if (!user) return
    if (!hasLoadedOnce.current) setDataLoading(true)
    const [cats, txs, gls, buds, rls, fds, flogs, ntargets, mems, paccts] = await Promise.all([
      api.ensureDefaultCategories(user.id),
      api.fetchTransactions(),
      api.fetchGoals(),
      // Budgets + merchant_rules live in migration 0002. If that hasn't been
      // run yet, degrade gracefully to empty instead of breaking the whole app.
      api.fetchBudgets().catch(() => []),
      api.fetchMerchantRules().catch(() => []),
      // Foods / food_logs / nutrition_targets live in migration 0003. Same
      // graceful degradation until that migration is run.
      api.fetchFoods().catch(() => []),
      api.fetchFoodLogs().catch(() => []),
      api.fetchNutritionTargets().catch(() => null),
      // Assistant memory lives in migration 0004; degrade gracefully until run.
      api.fetchMemories().catch(() => []),
      // Plaid account balances live in migration 0007; degrade gracefully.
      api.fetchPlaidAccounts().catch(() => []),
    ])

    // Auto-categorize: apply saved merchant rules to any uncategorized
    // transactions (e.g. new Plaid imports) so they don't need re-tagging.
    let finalTxs = txs
    const rulesByKey = new Map(rls.map((r) => [r.merchant_key, r.category_id]))
    const matches = matchRules(txs, rulesByKey)
    if (matches.length > 0) {
      const catById = new Map(cats.map((c) => [c.id, c]))
      await Promise.all(
        matches.map((m) =>
          api.updateTransaction(m.id, { category_id: m.categoryId, kind: catById.get(m.categoryId)?.kind })
        )
      )
      finalTxs = await api.fetchTransactions()
    }

    setCategories(cats)
    setTransactions(finalTxs)
    setGoals(gls)
    setBudgets(buds)
    setRules(rls)
    setFoods(fds)
    setFoodLogs(flogs)
    setNutritionTargets(ntargets)
    setMemories(mems)
    setPlaidAccounts(paccts ?? [])
    hasLoadedOnce.current = true
    setDataLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  if (loading) return <FullScreenMessage text="Loading…" />
  if (!user) return <Login />
  if (needsMfa) return <MfaChallenge />
  if (dataLoading) return <FullScreenMessage text="Loading your data…" />

  const rulesByKey = new Map(rules.map((r) => [r.merchant_key, r.category_id]))
  const savedMatchCount = matchRules(transactions, rulesByKey).length

  // Applies existing saved rules to whatever is currently uncategorized.
  const applySavedRules = async () => {
    const matches = matchRules(transactions, rulesByKey)
    if (matches.length === 0) return
    const catById = new Map(categories.map((c) => [c.id, c]))
    await Promise.all(
      matches.map((m) =>
        api.updateTransaction(m.id, { category_id: m.categoryId, kind: catById.get(m.categoryId)?.kind })
      )
    )
    setTransactions((prev) =>
      prev.map((t) => {
        const m = matches.find((x) => x.id === t.id)
        if (!m) return t
        const cat = catById.get(m.categoryId)
        return {
          ...t,
          category_id: m.categoryId,
          kind: cat?.kind ?? t.kind,
          category: cat ? { id: cat.id, name: cat.name, kind: cat.kind } : t.category,
        }
      })
    )
  }

  // Assign a category to one uncategorized transaction, remember the rule for
  // its merchant, and cascade the same category to other currently-uncategorized
  // transactions from that same merchant.
  const assignCategory = async (id, categoryId) => {
    const category = categories.find((c) => c.id === categoryId)
    const tx = transactions.find((t) => t.id === id)
    const updated = await api.updateTransaction(id, { category_id: categoryId, kind: category.kind })

    const key = merchantKey(tx?.note)
    let savedRule = null
    if (key) {
      try {
        savedRule = await api.upsertMerchantRule(key, categoryId)
      } catch {
        // merchant_rules table may not exist yet (migration 0002 not run) —
        // assignment still works, we just can't remember it.
      }
    }

    const cascadeIds = key
      ? transactions
          .filter((t) => t.id !== id && !t.category_id && merchantKey(t.note) === key)
          .map((t) => t.id)
      : []
    await Promise.all(
      cascadeIds.map((cid) => api.updateTransaction(cid, { category_id: categoryId, kind: category.kind }))
    )

    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === id) return updated
        if (cascadeIds.includes(t.id)) {
          return {
            ...t,
            category_id: categoryId,
            kind: category.kind,
            category: { id: category.id, name: category.name, kind: category.kind },
          }
        }
        return t
      })
    )
    if (savedRule) {
      setRules((prev) => [...prev.filter((r) => r.merchant_key !== key), savedRule])
    }
  }

  // Shared action wrappers (call the API AND keep local state in sync). The AI
  // assistant uses these so its changes show up instantly, just like the tabs.
  const actions = {
    addTransaction: async (values) => {
      const created = await api.createTransaction(values)
      setTransactions((prev) => [created, ...prev])
      return created
    },
    addCategory: async (values) => {
      const created = await api.createCategory(values)
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      return created
    },
    setBudget: async (categoryId, amount) => {
      const saved = await api.upsertBudget(categoryId, amount)
      setBudgets((prev) => [...prev.filter((b) => b.category_id !== categoryId), saved])
      return saved
    },
    addGoal: async (values) => {
      const created = await api.createGoal(values)
      setGoals((prev) => [...prev, created])
      return created
    },
    updateGoal: async (id, updates) => {
      const updated = await api.updateGoal(id, updates)
      setGoals((prev) => prev.map((g) => (g.id === id ? updated : g)))
      return updated
    },
    addFood: async (values) => {
      const created = await api.createFood(values)
      setFoods((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      return created
    },
    logFood: async (values) => {
      const created = await api.createFoodLog(values)
      setFoodLogs((prev) => [created, ...prev])
      return created
    },
    setTargets: async (values) => {
      const saved = await api.upsertNutritionTargets(values)
      setNutritionTargets(saved)
      return saved
    },
    addMemory: async (content) => {
      const created = await api.createMemory(content)
      setMemories((prev) => [...prev, created])
      return created
    },
    deleteMemory: async (id) => {
      await api.deleteMemory(id)
      setMemories((prev) => prev.filter((m) => m.id !== id))
    },
  }

  // First-run onboarding: show once to brand-new users (no transactions and no
  // saved `onboarded` flag). `onboardDismissed` hides it immediately for the
  // session; updateUser persists so it never returns on future logins.
  const showOnboarding =
    !onboardDismissed && !user.user_metadata?.onboarded && transactions.length === 0
  const finishOnboarding = () => {
    setOnboardDismissed(true)
    supabase.auth.updateUser({ data: { onboarded: true } }).catch(() => {})
  }

  // Seeds a realistic month of example transactions so a new user sees a full
  // dashboard (verdict, charts, recurring detection) instantly. Uses the
  // existing default categories by name.
  const loadSampleData = async () => {
    const today = new Date().toISOString().slice(0, 10)
    const catId = (name) => categories.find((c) => c.name === name)?.id ?? null
    const samples = [
      { date: addDays(today, -30), amount: 3200, kind: 'income', categoryId: catId('Salary'), note: 'Salary' },
      { date: today, amount: 3200, kind: 'income', categoryId: catId('Salary'), note: 'Salary' },
      { date: addDays(today, -32), amount: 1400, kind: 'expense', categoryId: catId('Housing & Rent'), note: 'Rent' },
      { date: addDays(today, -2), amount: 1400, kind: 'expense', categoryId: catId('Housing & Rent'), note: 'Rent' },
      { date: addDays(today, -30), amount: 15.99, kind: 'expense', categoryId: catId('Entertainment'), note: 'Netflix' },
      { date: addDays(today, -1), amount: 15.99, kind: 'expense', categoryId: catId('Entertainment'), note: 'Netflix' },
      { date: addDays(today, -6), amount: 82.4, kind: 'expense', categoryId: catId('Groceries'), note: 'Whole Foods' },
      { date: addDays(today, -2), amount: 54.1, kind: 'expense', categoryId: catId('Groceries'), note: 'Trader Joes' },
      { date: addDays(today, -5), amount: 44.0, kind: 'expense', categoryId: catId('Transportation'), note: 'Shell Gas' },
      { date: addDays(today, -4), amount: 65.0, kind: 'expense', categoryId: catId('Utilities'), note: 'Electric Bill' },
      { date: addDays(today, -3), amount: 12.75, kind: 'expense', categoryId: catId('Dining & Restaurants'), note: 'Chipotle' },
      { date: addDays(today, -1), amount: 8.5, kind: 'expense', categoryId: catId('Dining & Restaurants'), note: 'Blue Bottle Coffee' },
    ]
    await Promise.all(samples.map((s) => actions.addTransaction(s)))
    setActiveTab('Dashboard')
  }

  // Adds a transaction created from a scanned receipt, and — like manual
  // categorization — remembers the merchant→category rule so future purchases
  // from the same store auto-categorize (including Plaid imports).
  const addScannedTransaction = async (values) => {
    const created = await api.createTransaction(values)
    setTransactions((prev) => [created, ...prev])
    if (values.categoryId && values.note) {
      const key = merchantKey(values.note)
      if (key) {
        try {
          const rule = await api.upsertMerchantRule(key, values.categoryId)
          setRules((prev) => [...prev.filter((r) => r.merchant_key !== key), rule])
        } catch {
          // merchant_rules table may not exist yet (migration 0002) — the
          // transaction still saved; we just can't remember the rule.
        }
      }
    }
    return created
  }

  return (
    <div className="min-h-screen">
      <NavBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        userEmail={user.email}
        userName={user.user_metadata?.display_name}
        avatarUrl={user.user_metadata?.avatar_url}
        onSignOut={signOut}
      />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {activeTab === 'Dashboard' && (
          <Dashboard
            transactions={transactions}
            budgets={budgets}
            categories={categories}
            foodLogs={foodLogs}
            accounts={plaidAccounts}
            onNavigate={setActiveTab}
            onAsk={setAssistantPrompt}
          />
        )}

        {activeTab === 'Transactions' && (
          <>
            <PlaidLinkButton onLinked={loadAll} onSync={loadAll} />
            <ReceiptScanner categories={categories} onAdd={addScannedTransaction} />
            <UncategorizedBucket
              transactions={transactions}
              categories={categories}
              onAssign={assignCategory}
              onApplyRules={applySavedRules}
              savedMatchCount={savedMatchCount}
            />
            <TransactionList
              transactions={transactions}
              categories={categories}
              onCreate={async (values) => {
                const created = await api.createTransaction(values)
                setTransactions((prev) => [created, ...prev])
              }}
              onUpdate={async (id, updates) => {
                const updated = await api.updateTransaction(id, updates)
                setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)))
              }}
              onDelete={async (id) => {
                await api.deleteTransaction(id)
                setTransactions((prev) => prev.filter((t) => t.id !== id))
              }}
            />
          </>
        )}

        {activeTab === 'Budgets' && (
          <BudgetManager
            categories={categories}
            budgets={budgets}
            transactions={transactions}
            onSetBudget={async (categoryId, amount) => {
              const saved = await api.upsertBudget(categoryId, amount)
              setBudgets((prev) => [...prev.filter((b) => b.category_id !== categoryId), saved])
            }}
            onRemoveBudget={async (categoryId) => {
              await api.deleteBudget(categoryId)
              setBudgets((prev) => prev.filter((b) => b.category_id !== categoryId))
            }}
          />
        )}

        {activeTab === 'Meals' && (
          <MealTracker
            foods={foods}
            logs={foodLogs}
            targets={nutritionTargets}
            transactions={transactions}
            onAddFood={async (values) => {
              const created = await api.createFood(values)
              setFoods((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
            }}
            onDeleteFood={async (id) => {
              await api.deleteFood(id)
              setFoods((prev) => prev.filter((f) => f.id !== id))
            }}
            onLogFood={async (values) => {
              const created = await api.createFoodLog(values)
              setFoodLogs((prev) => [created, ...prev])
            }}
            onUpdateLog={async (id, updates) => {
              const updated = await api.updateFoodLog(id, updates)
              setFoodLogs((prev) => prev.map((l) => (l.id === id ? updated : l)))
            }}
            onDeleteLog={async (id) => {
              await api.deleteFoodLog(id)
              setFoodLogs((prev) => prev.filter((l) => l.id !== id))
            }}
            onSetTargets={async (values) => {
              const saved = await api.upsertNutritionTargets(values)
              setNutritionTargets(saved)
            }}
          />
        )}

        {activeTab === 'Goals' && (
          <GoalTracker
            goals={goals}
            onCreate={async (values) => {
              const created = await api.createGoal(values)
              setGoals((prev) => [...prev, created])
            }}
            onUpdate={async (id, updates) => {
              const updated = await api.updateGoal(id, updates)
              setGoals((prev) => prev.map((g) => (g.id === id ? updated : g)))
            }}
            onDelete={async (id) => {
              await api.deleteGoal(id)
              setGoals((prev) => prev.filter((g) => g.id !== id))
            }}
          />
        )}

        {activeTab === 'Categories' && (
          <CategoryManager
            categories={categories}
            onCreate={async (values) => {
              const created = await api.createCategory(values)
              setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
            }}
            onUpdate={async (id, updates) => {
              const updated = await api.updateCategory(id, updates)
              setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)))
            }}
            onDelete={async (id) => {
              await api.deleteCategory(id)
              setCategories((prev) => prev.filter((c) => c.id !== id))
              setTransactions((prev) =>
                prev.map((t) => (t.category_id === id ? { ...t, category_id: null, category: null } : t))
              )
              // DB cascades these; keep local state in sync.
              setBudgets((prev) => prev.filter((b) => b.category_id !== id))
              setRules((prev) => prev.filter((r) => r.category_id !== id))
            }}
            onReset={async () => {
              const fresh = await api.resetCategoriesToDefaults(user.id)
              setCategories(fresh.sort((a, b) => a.name.localeCompare(b.name)))
              // Every old category is gone, so anything that referenced one is
              // now cleared in the DB — mirror that in local state.
              setTransactions((prev) => prev.map((t) => ({ ...t, category_id: null, category: null })))
              setBudgets([])
              setRules([])
            }}
          />
        )}

        {activeTab === 'Settings' && (
          <Settings
            data={{ categories, transactions, budgets, goals, nutritionTargets, foods, foodLogs, memories }}
          />
        )}
      </main>

      <ChatWidget
        context={{ categories, transactions, budgets, goals, nutritionTargets, foods, foodLogs, memories }}
        actions={actions}
        setActiveTab={setActiveTab}
        openWith={assistantPrompt}
        onConsumeOpenWith={() => setAssistantPrompt(null)}
      />

      {showOnboarding && (
        <Onboarding onFinish={finishOnboarding} onNavigate={setActiveTab} onLoadSample={loadSampleData} />
      )}
    </div>
  )
}

function FullScreenMessage({ text }) {
  return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">{text}</div>
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  )
}
