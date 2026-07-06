import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import Login from './components/Login'
import Landing from './components/Landing'
import MfaChallenge from './components/MfaChallenge'
import NavBar from './components/NavBar'
import UncategorizedBucket from './components/UncategorizedBucket'
import UpgradeGate from './components/UpgradeGate'
// Tab bodies are code-split: each loads its own chunk (and heavy deps like
// Recharts) only when the user first opens that tab, keeping the initial
// bundle small. Suspense shows TabSkeleton while a chunk is fetched.
const Dashboard = lazy(() => import('./components/Dashboard'))
const TransactionList = lazy(() => import('./components/TransactionList'))
const BudgetManager = lazy(() => import('./components/BudgetManager'))
const CreditTab = lazy(() => import('./components/CreditTab'))
const MealTracker = lazy(() => import('./components/MealTracker'))
const GoalTracker = lazy(() => import('./components/GoalTracker'))
const CategoryManager = lazy(() => import('./components/CategoryManager'))
const Settings = lazy(() => import('./components/Settings'))
// The floating assistant is always mounted but never needed for first paint,
// so it (and its chat library) load after the initial render.
const ChatWidget = lazy(() => import('./components/ChatWidget'))
// Transactions-only + first-run components: keep react-plaid-link and the
// receipt/image code out of the entry chunk until actually needed.
const PlaidLinkButton = lazy(() => import('./components/PlaidLinkButton'))
const ReceiptScanner = lazy(() => import('./components/ReceiptScanner'))
const Onboarding = lazy(() => import('./components/Onboarding'))
import * as api from './lib/api'
import { supabase } from './lib/supabaseClient'
import { merchantKey, matchRules } from './lib/analysis'
import { perUnitCost } from './lib/receiptMatch'
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
  const [creditScores, setCreditScores] = useState([])
  // Itemized receipts (migration 0016) and the remembered raw-item→food rules.
  const [receipts, setReceipts] = useState([])
  const [receiptItemRules, setReceiptItemRules] = useState([])
  // The latest weekly digest the user hasn't dismissed (migration 0015),
  // surfaced as a card at the top of the Dashboard. null when there's none.
  const [latestDigest, setLatestDigest] = useState(null)
  // Free vs. pro. Drives which features are gated behind an upgrade card.
  const [entitlements, setEntitlements] = useState({ plan: 'free', status: null, period_end: null })
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
    const [cats, txs, gls, buds, rls, fds, flogs, ntargets, mems, paccts, cscores, digest, ents, rcpts, ritemrules] = await Promise.all([
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
      // Manual credit-score log lives in migration 0009; degrade gracefully.
      api.fetchCreditScores().catch(() => []),
      // Latest weekly digest lives in migration 0015; null until that runs.
      api.fetchLatestDigest().catch(() => null),
      // Plan/entitlements live in migration 0012; default to free if unavailable.
      api.fetchEntitlements().catch(() => ({ plan: 'free', status: null, period_end: null })),
      // Itemized receipts + item rules live in migration 0016; degrade gracefully.
      api.fetchReceipts().catch(() => []),
      api.fetchReceiptItemRules().catch(() => []),
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
    setCreditScores(cscores ?? [])
    setLatestDigest(digest ?? null)
    setEntitlements(ents ?? { plan: 'free', status: null, period_end: null })
    setReceipts(rcpts ?? [])
    setReceiptItemRules(ritemrules ?? [])
    hasLoadedOnce.current = true
    setDataLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Re-checks the current plan (after returning from Stripe, or from the
  // Settings billing section).
  const refreshEntitlements = useCallback(async () => {
    const ents = await api.fetchEntitlements().catch(() => null)
    if (ents) setEntitlements(ents)
  }, [])

  // Handle the browser coming back from Stripe Checkout / the Billing Portal.
  // Stripe redirects to /?billing=success|cancel|portal. On success the webhook
  // grants Pro server-side, but it can lag a couple seconds, so we poll the
  // plan briefly. We strip the query param first so a refresh doesn't re-run it.
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    const billing = params.get('billing')
    if (!billing) return
    window.history.replaceState({}, '', window.location.pathname)
    if (billing === 'success') {
      setActiveTab('Settings')
      let tries = 0
      const id = setInterval(async () => {
        tries++
        const ents = await api.fetchEntitlements().catch(() => null)
        if (ents?.plan === 'pro' || tries >= 6) {
          if (ents) setEntitlements(ents)
          clearInterval(id)
        }
      }, 2000)
      return () => clearInterval(id)
    }
    if (billing === 'portal') {
      setActiveTab('Settings')
      refreshEntitlements()
    }
  }, [user, refreshEntitlements])

  if (loading) return <FullScreenMessage text="Loading…" />
  if (!user) return <SignedOut />
  if (needsMfa) return <MfaChallenge />
  if (dataLoading) return <FullScreenMessage text="Loading your data…" />

  const rulesByKey = new Map(rules.map((r) => [r.merchant_key, r.category_id]))
  const savedMatchCount = matchRules(transactions, rulesByKey).length
  const plan = entitlements?.plan ?? 'free'

  // Which Plaid/manual transactions already carry a receipt, and a lookup for
  // the transaction-list receipt indicator. A transaction can hold one receipt.
  const matchedTransactionIds = new Set(
    receipts.map((r) => r.matched_transaction_id).filter(Boolean)
  )
  const receiptsByTransaction = new Map(
    receipts.filter((r) => r.matched_transaction_id).map((r) => [r.matched_transaction_id, r])
  )

  // Dismiss the in-app digest card (persists via the digests.dismissed flag,
  // then clears it locally so it disappears immediately).
  const dismissLatestDigest = async () => {
    if (!latestDigest) return
    const id = latestDigest.id
    setLatestDigest(null)
    try {
      await api.dismissDigest(id)
    } catch {
      // Non-fatal: the card is gone for this session even if the flag fails.
    }
  }

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

  // Seeds a realistic month of example transactions AND a few logged meals so a
  // new user immediately sees the money+food dashboard fully populated — the
  // Food & Money hero (cost/day, cost per protein), the cheapest-protein card,
  // and the verdict/charts. Uses the existing default categories by name.
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
      // Older food spend so the "vs 3-month average" food burn has a baseline.
      { date: addDays(today, -38), amount: 61.0, kind: 'expense', categoryId: catId('Groceries'), note: 'Safeway' },
      { date: addDays(today, -68), amount: 73.5, kind: 'expense', categoryId: catId('Groceries'), note: 'Costco' },
      { date: addDays(today, -40), amount: 24.0, kind: 'expense', categoryId: catId('Dining & Restaurants'), note: 'Local Diner' },
      { date: addDays(today, -5), amount: 44.0, kind: 'expense', categoryId: catId('Transportation'), note: 'Shell Gas' },
      { date: addDays(today, -4), amount: 65.0, kind: 'expense', categoryId: catId('Utilities'), note: 'Electric Bill' },
      { date: addDays(today, -3), amount: 12.75, kind: 'expense', categoryId: catId('Dining & Restaurants'), note: 'Chipotle' },
      { date: addDays(today, -1), amount: 8.5, kind: 'expense', categoryId: catId('Dining & Restaurants'), note: 'Blue Bottle Coffee' },
    ]
    await Promise.all(samples.map((s) => actions.addTransaction(s)))

    // A small food library with per-serving protein + cost powers the
    // cheapest-protein ranking and the cost-per-protein number.
    const sampleFoods = [
      { name: 'Chicken breast', servingDesc: '6 oz', calories: 220, protein: 40, carbs: 0, fat: 5, cost: 2.5 },
      { name: 'Whey protein', servingDesc: '1 scoop', calories: 120, protein: 24, carbs: 3, fat: 1.5, cost: 1.1 },
      { name: 'Eggs', servingDesc: '2 eggs', calories: 140, protein: 12, carbs: 1, fat: 10, cost: 0.6 },
      { name: 'Greek yogurt', servingDesc: '1 cup', calories: 100, protein: 17, carbs: 6, fat: 0, cost: 1.2 },
      { name: 'White rice', servingDesc: '1 cup', calories: 200, protein: 4, carbs: 44, fat: 0, cost: 0.4 },
    ]
    const createdFoods = await Promise.all(sampleFoods.map((f) => actions.addFood(f)))
    const food = (name) => createdFoods.find((f) => f.name === name)
    const logOne = (offset, meal, name, servings, costOverride) => {
      const f = food(name)
      if (!f) return null
      return actions.logFood({
        date: addDays(today, offset),
        meal,
        foodId: f.id,
        name: f.name,
        servings,
        calories: f.calories,
        protein: f.protein,
        carbs: f.carbs,
        fat: f.fat,
        // One meal is left costless on purpose so the coverage % is realistic.
        cost: costOverride === undefined ? f.cost : costOverride,
      })
    }
    await Promise.all(
      [
        logOne(-1, 'breakfast', 'Greek yogurt', 1),
        logOne(-1, 'breakfast', 'Eggs', 1),
        logOne(-1, 'lunch', 'Chicken breast', 1),
        logOne(-1, 'lunch', 'White rice', 1),
        logOne(-1, 'snack', 'Whey protein', 1),
        logOne(-2, 'lunch', 'Chicken breast', 1),
        logOne(-2, 'dinner', 'White rice', 1, null),
        logOne(-3, 'breakfast', 'Greek yogurt', 1),
        logOne(-3, 'snack', 'Whey protein', 1),
        logOne(-4, 'lunch', 'Eggs', 2),
      ].filter(Boolean)
    )

    // A protein-forward daily target lights up the "hitting your goal runs
    // $X/mo" line on the hero card.
    await actions.setTargets({ calories: 2200, protein: 150, carbs: 220, fat: 70 }).catch(() => {})

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

  // Persists a scanned itemized receipt. If it matched a Plaid charge, that row
  // stays the money record — no duplicate transaction. If not, we fall back to
  // creating a manual transaction from the total and link the receipt to it.
  // Returns { receipt (with items), transaction } for the mapping step.
  const saveScannedReceipt = async ({ receipt, items, matchedTransaction }) => {
    let transaction = matchedTransaction || null
    let matchedTransactionId = matchedTransaction?.id || null

    if (!transaction) {
      transaction = await api.createTransaction({
        date: receipt.purchase_date,
        amount: receipt.total,
        kind: 'expense',
        categoryId: null,
        note: receipt.store_name || null,
      })
      setTransactions((prev) => [transaction, ...prev])
      matchedTransactionId = transaction.id
    }

    const savedReceipt = await api.createReceipt({
      storeName: receipt.store_name,
      purchaseDate: receipt.purchase_date,
      total: receipt.total,
      matchedTransactionId,
    })
    const savedItems = await api.createReceiptItems(savedReceipt.id, items)
    const full = { ...savedReceipt, items: savedItems }
    setReceipts((prev) => [full, ...prev])
    return { receipt: full, transaction }
  }

  // Maps one receipt line to a library food: links receipt_items.food_id, saves
  // the raw-item→food rule for next time, and flows the receipt price into the
  // food's remembered default cost (per-unit when a weight/qty is present).
  const mapReceiptItem = async ({ item, food, itemKey }) => {
    const updatedItem = await api.updateReceiptItem(item.id, { food_id: food.id })

    let rule = null
    try {
      rule = await api.upsertReceiptItemRule(itemKey, food.id)
    } catch {
      // receipt_item_rules may not exist yet (migration 0016) — mapping still works.
    }

    const newCost = perUnitCost(item.price, item.quantity)
    if (newCost != null) {
      try {
        await api.updateFood(food.id, { cost: newCost })
        setFoods((prev) => prev.map((f) => (f.id === food.id ? { ...f, cost: newCost } : f)))
      } catch {
        // Non-fatal: the mapping is saved even if the cost write fails.
      }
    }

    setReceipts((prev) =>
      prev.map((r) =>
        r.id === item.receipt_id
          ? { ...r, items: r.items.map((it) => (it.id === item.id ? updatedItem : it)) }
          : r
      )
    )
    if (rule) setReceiptItemRules((prev) => [...prev.filter((x) => x.item_key !== itemKey), rule])
    return updatedItem
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
        <Suspense fallback={<TabSkeleton />}>
        {activeTab === 'Dashboard' && (
          <Dashboard
            transactions={transactions}
            budgets={budgets}
            categories={categories}
            foods={foods}
            foodLogs={foodLogs}
            nutritionTargets={nutritionTargets}
            accounts={plaidAccounts}
            digest={latestDigest}
            displayName={user.user_metadata?.display_name}
            onDismissDigest={dismissLatestDigest}
            onNavigate={setActiveTab}
            onAsk={setAssistantPrompt}
            onLogFood={actions.logFood}
          />
        )}

        {activeTab === 'Transactions' && (
          <>
            <UpgradeGate
              plan={plan}
              title="Connect your bank — a Pro feature"
              blurb="Free covers manual entry and receipt scanning. Pro adds automatic bank & credit-card import and syncing."
            >
              <PlaidLinkButton onLinked={loadAll} onSync={loadAll} />
            </UpgradeGate>
            <ReceiptScanner
              categories={categories}
              onAdd={addScannedTransaction}
              itemize={{
                transactions,
                foods,
                receiptItemRules,
                matchedTransactionIds,
                onSearchFoods: api.searchFoods,
                onSaveReceipt: saveScannedReceipt,
                onMapItem: mapReceiptItem,
                onCreateFood: actions.addFood,
                onApplyCategory: assignCategory,
              }}
            />
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
              receiptsByTransaction={receiptsByTransaction}
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

        {activeTab === 'Credit' && (
          <CreditTab
            scores={creditScores}
            accounts={plaidAccounts}
            onAdd={async (values) => {
              const created = await api.createCreditScore(values)
              setCreditScores((prev) => [...prev, created])
              return created
            }}
            onDelete={async (id) => {
              await api.deleteCreditScore(id)
              setCreditScores((prev) => prev.filter((s) => s.id !== id))
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
            onUpdateFood={async (id, updates) => {
              const updated = await api.updateFood(id, updates)
              setFoods((prev) => prev.map((f) => (f.id === id ? updated : f)))
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
            onSearchFoods={api.searchFoods}
            onFoodDetails={api.getFoodDetails}
          />
        )}

        {activeTab === 'Goals' && (
          <GoalTracker
            goals={goals}
            displayName={user.user_metadata?.display_name}
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
            entitlements={entitlements}
          />
        )}
        </Suspense>
      </main>

      <Suspense fallback={null}>
        <ChatWidget
          plan={plan}
          context={{ categories, transactions, budgets, goals, nutritionTargets, foods, foodLogs, memories }}
          actions={actions}
          setActiveTab={setActiveTab}
          openWith={assistantPrompt}
          onConsumeOpenWith={() => setAssistantPrompt(null)}
        />
      </Suspense>

      {showOnboarding && (
        <Suspense fallback={null}>
          <Onboarding onFinish={finishOnboarding} onNavigate={setActiveTab} onLoadSample={loadSampleData} />
        </Suspense>
      )}
    </div>
  )
}

// True when the URL carries Supabase auth params — an OAuth/magic-link return
// (`?code=…`), an implicit-flow token or password-recovery (`#access_token…&type=recovery`),
// or an auth error. In those cases we skip the marketing page and land on Login
// so existing sign-in flows (and any error message) surface directly.
function hasAuthParams() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  const search = window.location.search || ''
  return /(?:access_token|refresh_token|provider_token|[?&#]code=|[?&#]type=|[?&#]error=|error_description)/.test(
    hash + search
  )
}

// Signed-out experience: the landing page by default, swapping to Login when the
// visitor chooses to sign in / get started — or immediately when an auth return
// URL is detected. Simple useState, the same pattern the app uses elsewhere.
function SignedOut() {
  const [view, setView] = useState(hasAuthParams() ? 'login' : 'landing')
  const [loginMode, setLoginMode] = useState('signin')

  if (view === 'login') {
    return <Login initialMode={loginMode} onBack={() => setView('landing')} />
  }
  return (
    <Landing
      onGetStarted={() => {
        setLoginMode('signup')
        setView('login')
      }}
      onSignIn={() => {
        setLoginMode('signin')
        setView('login')
      }}
    />
  )
}

function FullScreenMessage({ text }) {
  return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">{text}</div>
}

// Lightweight placeholder shown while a lazily-loaded tab chunk is fetched.
function TabSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-32 rounded-xl bg-slate-200 dark:bg-slate-800" />
      <div className="h-48 rounded-xl bg-slate-200 dark:bg-slate-800" />
    </div>
  )
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
