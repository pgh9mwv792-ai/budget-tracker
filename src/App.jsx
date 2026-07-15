import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import Login from './components/Login'
import Landing from './components/Landing'
import MfaChallenge from './components/MfaChallenge'
import NavBar from './components/NavBar'
import NeedsReview from './components/NeedsReview'
import UpgradeGate from './components/UpgradeGate'
// Tab bodies are code-split: each loads its own chunk (and heavy deps like
// Recharts) only when the user first opens that tab, keeping the initial
// bundle small. Suspense shows TabSkeleton while a chunk is fetched.
const Dashboard = lazy(() => import('./components/Dashboard'))
const TransactionList = lazy(() => import('./components/TransactionList'))
const Calendar = lazy(() => import('./components/Calendar'))
const BudgetManager = lazy(() => import('./components/BudgetManager'))
const CreditTab = lazy(() => import('./components/CreditTab'))
const MealTracker = lazy(() => import('./components/MealTracker'))
const GoalTracker = lazy(() => import('./components/GoalTracker'))
const CategoryManager = lazy(() => import('./components/CategoryManager'))
const Settings = lazy(() => import('./components/Settings'))
const Subscriptions = lazy(() => import('./components/Subscriptions'))
// The floating assistant is always mounted but never needed for first paint,
// so it (and its chat library) load after the initial render.
const ChatWidget = lazy(() => import('./components/ChatWidget'))
// Transactions-only + first-run components: keep react-plaid-link and the
// receipt/image code out of the entry chunk until actually needed.
const PlaidLinkButton = lazy(() => import('./components/PlaidLinkButton'))
const ReceiptScanner = lazy(() => import('./components/ReceiptScanner'))
const ScheduleEntryBar = lazy(() => import('./components/ScheduleEntryBar'))
const Onboarding = lazy(() => import('./components/Onboarding'))
// Signed-out sample-data explorer: loads only when a visitor opens the demo.
const DemoMode = lazy(() => import('./components/DemoMode'))
import * as api from './lib/api'
import { Delayed } from './components/ui/Skeleton'
import { useDelayedFlag } from './lib/useDelayedFlag'
import {
  DashboardSkeleton,
  TransactionListSkeleton,
  BudgetManagerSkeleton,
  CreditTabSkeleton,
  MealTrackerSkeleton,
  GoalTrackerSkeleton,
  CategoryManagerSkeleton,
  CalendarSkeleton,
} from './components/Skeletons'
import { supabase } from './lib/supabaseClient'
import { merchantKey, matchRules } from './lib/analysis'
import { perUnitCost } from './lib/receiptMatch'
import { pairTransfers } from './lib/transferPair'
import { addDays, todayISO } from './lib/dateHelpers'
import { buildScheduleEventRows, localTimeZone } from './lib/schedule'

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
  // Saved "usual" meals (migration 0028): one-tap re-logging + weekday planning.
  const [mealTemplates, setMealTemplates] = useState([])
  const [nutritionTargets, setNutritionTargets] = useState(null)
  const [memories, setMemories] = useState([])
  const [plaidAccounts, setPlaidAccounts] = useState([])
  const [creditScores, setCreditScores] = useState([])
  // Calendar feature (migration 0031): employers/wages, recurring schedule
  // rules, and their materialized event instances. Bills/paydays are NOT stored
  // here — they render live from recurring-transaction detection.
  const [incomeSources, setIncomeSources] = useState([])
  const [scheduleRules, setScheduleRules] = useState([])
  const [calendarEvents, setCalendarEvents] = useState([])
  // Itemized receipts (migration 0016) and the remembered raw-item→food rules.
  const [receipts, setReceipts] = useState([])
  const [receiptItemRules, setReceiptItemRules] = useState([])
  // Per-merchant curation of recurring-charge detection (migration 0019).
  const [recurringOverrides, setRecurringOverrides] = useState([])
  // Saved links between the two legs of one internal transfer (migration 0029),
  // plus the client-computed "suspected" pairs awaiting user confirmation (held
  // in memory only — surfaced in the Needs-review strip, never auto-linked).
  const [transferPairs, setTransferPairs] = useState([])
  const [suspectedTransferPairs, setSuspectedTransferPairs] = useState([])
  // The latest weekly digest the user hasn't dismissed (migration 0015),
  // surfaced as a card at the top of the Dashboard. null when there's none.
  const [latestDigest, setLatestDigest] = useState(null)
  // Free vs. pro. Drives which features are gated behind an upgrade card.
  const [entitlements, setEntitlements] = useState({ plan: 'free', status: null, period_end: null })
  const [dataLoading, setDataLoading] = useState(true)
  // Delay the skeleton by 200ms so a fast initial load never flashes it.
  const showSkeleton = useDelayedFlag(dataLoading, 200)
  const [onboardDismissed, setOnboardDismissed] = useState(false)
  // One-shot signal: a new user chose "Scan a receipt" in onboarding, so the
  // Transactions tab should scroll to and highlight the receipt scanner.
  const [receiptFocus, setReceiptFocus] = useState(false)
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
    const [cats, txs, gls, buds, rls, fds, flogs, mtmpls, ntargets, mems, paccts, cscores, digest, ents, rcpts, ritemrules, recovr, tpairs, isources, srules, cevents] = await Promise.all([
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
      // Saved meal templates live in migration 0028; degrade gracefully until run.
      api.fetchMealTemplates().catch(() => []),
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
      // Recurring-charge overrides live in migration 0019; degrade gracefully.
      api.fetchRecurringOverrides().catch(() => []),
      // Saved transfer-pair links live in migration 0029; degrade gracefully.
      api.fetchTransferPairs().catch(() => []),
      // Calendar tables live in migration 0031; degrade gracefully until run.
      api.fetchIncomeSources().catch(() => []),
      api.fetchScheduleRules().catch(() => []),
      api.fetchCalendarEvents().catch(() => []),
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
    setMealTemplates(mtmpls ?? [])
    setNutritionTargets(ntargets)
    setMemories(mems)
    setPlaidAccounts(paccts ?? [])
    setCreditScores(cscores ?? [])
    setLatestDigest(digest ?? null)
    setEntitlements(ents ?? { plan: 'free', status: null, period_end: null })
    setReceipts(rcpts ?? [])
    setReceiptItemRules(ritemrules ?? [])
    setRecurringOverrides(recovr ?? [])
    setIncomeSources(isources ?? [])
    setScheduleRules(srules ?? [])
    setCalendarEvents(cevents ?? [])

    // Reconcile transfer pairs over the freshly-loaded transactions: auto-link
    // confident matches (persisted), and hold suspected matches in memory for
    // the Needs-review strip. Pairing only ever adds a link row — it never
    // touches the transactions themselves. Degrades to no-op until 0029 is run.
    const savedPairs = tpairs ?? []
    const pairedIds = new Set(savedPairs.flatMap((p) => [p.transaction_a, p.transaction_b]))
    const { autoPairs, suspectedPairs } = pairTransfers(finalTxs, { alreadyPairedIds: pairedIds })
    const createdPairs = []
    for (const p of autoPairs) {
      try {
        createdPairs.push(
          await api.createTransferPair({ transactionA: p.a.id, transactionB: p.b.id, status: 'auto' })
        )
      } catch {
        // transfer_pairs table may not exist yet (0029), or the leg was linked
        // concurrently — pairing is best-effort, so skip and move on.
      }
    }
    setTransferPairs([...savedPairs, ...createdPairs])
    setSuspectedTransferPairs(suspectedPairs)

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
  // While the initial data load runs we no longer blank the whole screen — the
  // nav and chrome render, and each active tab shows its own skeleton below.

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
    // Mark this as a deliberate human choice so a later sync / auto-rule leaves
    // it alone (see matchRules and the Plaid sync's payroll auto-categorization).
    const updated = await api.updateTransaction(id, {
      category_id: categoryId,
      kind: category.kind,
      user_categorized: true,
    })

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
    updateFood: async (id, updates) => {
      const updated = await api.updateFood(id, updates)
      setFoods((prev) => prev.map((f) => (f.id === id ? updated : f)))
      return updated
    },
    logFood: async (values) => {
      const created = await api.createFoodLog(values)
      setFoodLogs((prev) => [created, ...prev])
      return created
    },
    addMealTemplate: async (values) => {
      const created = await api.createMealTemplate(values)
      setMealTemplates((prev) => [...prev, created])
      return created
    },
    updateMealTemplate: async (id, updates) => {
      const updated = await api.updateMealTemplate(id, updates)
      setMealTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)))
      return updated
    },
    deleteMealTemplate: async (id) => {
      await api.deleteMealTemplate(id)
      setMealTemplates((prev) => prev.filter((t) => t.id !== id))
    },
    // Log every item of a template to a date, each tagged with the template id so
    // "already logged today" is queryable. Returns the created logs.
    logMealTemplate: async (template, { date, meal } = {}) => {
      const targetMeal = meal ?? template.meal ?? null
      const created = []
      for (const it of template.items || []) {
        const log = await api.createFoodLog({
          date,
          meal: targetMeal,
          foodId: it.food_id || null,
          name: it.name,
          servings: Number(it.servings) || 1,
          calories: Number(it.calories) || 0,
          protein: Number(it.protein) || 0,
          carbs: Number(it.carbs) || 0,
          fat: Number(it.fat) || 0,
          cost: it.cost == null ? null : Number(it.cost),
          templateId: template.id,
        })
        created.push(log)
      }
      setFoodLogs((prev) => [...created, ...prev])
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
    const today = todayISO()
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

  // Persists a confirmed schedule from the Calendar's AI entry bar. A recurring
  // draft becomes a schedule_rule materialized 8 weeks forward; a one-time draft
  // becomes standalone events. Reuses the first known employer's wage (if any)
  // so shift gross is filled in; the wage dialog sets that up separately.
  const commitSchedule = async (draft) => {
    const timezone = localTimeZone()
    let source = incomeSources[0] ?? null

    // First-shift wage setup: if the user entered a rate and we have no employer
    // yet, create one now so gross fills in and future shifts reuse it.
    if (!source && draft.wage) {
      source = await api.createIncomeSource({
        name: draft.wage.name,
        hourlyRate: draft.wage.hourlyRate,
        closeTime: draft.wage.closeTime ?? null,
      })
      setIncomeSources((prev) => [...prev, source])
    }

    const hourlyRate = source?.hourly_rate != null ? Number(source.hourly_rate) : null
    const title = source?.name || draft.employer || 'Shift'

    let ruleId = null
    if (draft.recurring && draft.days_of_week.length) {
      const rule = await api.createScheduleRule({
        incomeSourceId: source?.id ?? null,
        kind: 'shift',
        title,
        daysOfWeek: draft.days_of_week,
        startTime: draft.shifts[0].start_time,
        endTime: draft.shifts[0].end_time,
        startsOn: todayISO(),
        source: 'ai',
        rawInput: draft.rawInput,
      })
      ruleId = rule.id
      setScheduleRules((prev) => [...prev, rule])
    }

    const rows = buildScheduleEventRows(draft, {
      today: todayISO(),
      timezone,
      hourlyRate,
      title,
      ids: { ruleId, incomeSourceId: source?.id ?? null },
    })
    const created = await api.createCalendarEvents(rows)
    setCalendarEvents((prev) => [...prev, ...created])
  }

  // Cancel a single shift instance without touching its rule (is_exception).
  const cancelCalendarEvent = async (event) => {
    const updated = await api.updateCalendarEvent(event.id, { status: 'cancelled', is_exception: true })
    setCalendarEvents((prev) => prev.map((e) => (e.id === event.id ? updated : e)))
  }

  // Delete a whole recurring series: the rule and (via cascade) all its events.
  const deleteCalendarSeries = async (ruleId) => {
    await api.deleteScheduleRule(ruleId)
    setScheduleRules((prev) => prev.filter((r) => r.id !== ruleId))
    setCalendarEvents((prev) => prev.filter((e) => e.rule_id !== ruleId))
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

  // Curate the recurring-charge detection: confirm a marginal group, exclude a
  // false positive (e.g. groceries), or set a friendly nickname. Persists to
  // recurring_overrides and keeps local state in sync so the Subscriptions view
  // updates instantly.
  const setRecurringOverride = async (merchantKey, { status, nickname }) => {
    const saved = await api.upsertRecurringOverride(merchantKey, { status, nickname })
    setRecurringOverrides((prev) => [...prev.filter((o) => o.merchant_key !== merchantKey), saved])
  }
  const clearRecurringOverride = async (merchantKey) => {
    await api.deleteRecurringOverride(merchantKey)
    setRecurringOverrides((prev) => prev.filter((o) => o.merchant_key !== merchantKey))
  }

  // Confirm a suspected transfer pair from the Needs-review strip: persist the
  // link (status 'confirmed') and drop it from the suspected list. Both
  // transactions stay exactly as they are — only a link row is created.
  const confirmTransferPair = async (pair) => {
    const saved = await api.createTransferPair({
      transactionA: pair.a.id,
      transactionB: pair.b.id,
      status: 'confirmed',
    })
    setTransferPairs((prev) => [...prev, saved])
    setSuspectedTransferPairs((prev) =>
      prev.filter((p) => !(p.a.id === pair.a.id && p.b.id === pair.b.id))
    )
    return saved
  }

  // Dismiss a suspected pair without linking it ("not the same payment") — just
  // removes it from the in-memory review list for this session.
  const dismissSuspectedPair = (pair) => {
    setSuspectedTransferPairs((prev) =>
      prev.filter((p) => !(p.a.id === pair.a.id && p.b.id === pair.b.id))
    )
  }

  // Unpair (from a combined transfer row): delete the link row. The two
  // transactions are untouched and simply render as separate legs again.
  const unpairTransfer = async (pairId) => {
    await api.deleteTransferPair(pairId)
    setTransferPairs((prev) => prev.filter((p) => p.id !== pairId))
  }

  // The skeleton that stands in for the active tab — used both as the lazy-chunk
  // Suspense fallback and as the initial-data-load placeholder.
  const tabSkeleton =
    {
      Dashboard: <DashboardSkeleton />,
      Transactions: <TransactionListSkeleton />,
      Budgets: <BudgetManagerSkeleton />,
      Credit: <CreditTabSkeleton />,
      Meals: <MealTrackerSkeleton />,
      Goals: <GoalTrackerSkeleton />,
      Categories: <CategoryManagerSkeleton />,
      Calendar: <CalendarSkeleton />,
    }[activeTab] ?? <TabSkeleton />

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

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 pb-[calc(4rem+env(safe-area-inset-bottom)+1.5rem)] md:pb-6">
        <Suspense fallback={<Delayed>{tabSkeleton}</Delayed>}>
        {dataLoading ? (
          showSkeleton ? tabSkeleton : null
        ) : (
        <>
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
            <Subscriptions
              transactions={transactions}
              overrides={recurringOverrides}
              onSetOverride={setRecurringOverride}
              onClearOverride={clearRecurringOverride}
            />
            <UpgradeGate
              plan={plan}
              title="Connect your bank — a Pro feature"
              blurb="Free covers manual entry and receipt scanning. Pro adds automatic bank & credit-card import and syncing — which also powers automatic subscription & recurring-bill tracking."
            >
              <PlaidLinkButton onLinked={loadAll} onSync={loadAll} />
            </UpgradeGate>
            <ReceiptScanner
              categories={categories}
              onAdd={addScannedTransaction}
              autoFocus={receiptFocus}
              onAutoFocusDone={() => setReceiptFocus(false)}
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
            <NeedsReview
              transactions={transactions}
              categories={categories}
              onAssignCategory={assignCategory}
              onApplyRules={applySavedRules}
              savedMatchCount={savedMatchCount}
              receipts={receipts}
              suspectedPairs={suspectedTransferPairs}
              onConfirmPair={confirmTransferPair}
              onDismissPair={dismissSuspectedPair}
              recurringOverrides={recurringOverrides}
              onSetRecurringOverride={setRecurringOverride}
            />
            <TransactionList
              transactions={transactions}
              categories={categories}
              receiptsByTransaction={receiptsByTransaction}
              accounts={plaidAccounts}
              transferPairs={transferPairs}
              onCreate={async (values) => {
                const created = await api.createTransaction(values)
                setTransactions((prev) => [created, ...prev])
              }}
              onUpdate={async (id, updates) => {
                // The edit sheet always carries the category the user confirmed,
                // so any save through it counts as a deliberate categorization —
                // flag it so sync / auto-rules never overwrite the choice.
                const patch =
                  'category_id' in updates ? { ...updates, user_categorized: true } : updates
                const updated = await api.updateTransaction(id, patch)
                setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)))
              }}
              onDelete={async (id) => {
                await api.deleteTransaction(id)
                setTransactions((prev) => prev.filter((t) => t.id !== id))
              }}
              onUnpair={unpairTransfer}
            />
          </>
        )}

        {activeTab === 'Calendar' && (
          <Calendar
            transactions={transactions}
            events={calendarEvents}
            overrides={recurringOverrides}
            onCancelEvent={cancelCalendarEvent}
            onDeleteSeries={deleteCalendarSeries}
            entryBar={
              <ScheduleEntryBar
                onCommit={commitSchedule}
                userName={user.user_metadata?.display_name}
                hourlyRate={incomeSources[0]?.hourly_rate != null ? Number(incomeSources[0].hourly_rate) : null}
                employerGuess={incomeSources[0]?.name ?? null}
                closeTime={incomeSources[0]?.close_time ?? null}
              />
            }
          />
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
            mealTemplates={mealTemplates}
            onSaveTemplate={actions.addMealTemplate}
            onUpdateTemplate={actions.updateMealTemplate}
            onDeleteTemplate={actions.deleteMealTemplate}
            onLogTemplate={actions.logMealTemplate}
            onAddFood={async (values) => {
              const created = await api.createFood(values)
              setFoods((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
              return created
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
            onImportLogs={async (drafts) => {
              const created = []
              for (const d of drafts) created.push(await api.createFoodLog(d))
              setFoodLogs((prev) => [...created, ...prev])
            }}
            onSetTargets={async (values) => {
              const saved = await api.upsertNutritionTargets(values)
              setNutritionTargets(saved)
            }}
            onSearchFoods={api.searchFoods}
            onFoodDetails={api.getFoodDetails}
            onBarcodeLookup={api.lookupBarcode}
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
            onSetTargets={async (values) => {
              const saved = await api.upsertNutritionTargets(values)
              setNutritionTargets(saved)
            }}
          />
        )}
        </>
        )}
        </Suspense>
      </main>

      <Suspense fallback={null}>
        <ChatWidget
          plan={plan}
          context={{ categories, transactions, budgets, goals, nutritionTargets, foods, foodLogs, mealTemplates, memories }}
          actions={actions}
          setActiveTab={setActiveTab}
          openWith={assistantPrompt}
          onConsumeOpenWith={() => setAssistantPrompt(null)}
        />
      </Suspense>

      {showOnboarding && (
        <Suspense fallback={null}>
          <Onboarding
            onFinish={finishOnboarding}
            onNavigate={setActiveTab}
            onLoadSample={loadSampleData}
            onScanReceipt={() => {
              setReceiptFocus(true)
              setActiveTab('Transactions')
            }}
          />
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

  const openLogin = (mode) => {
    setLoginMode(mode)
    setView('login')
  }

  if (view === 'demo') {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading demo…" />}>
        <DemoMode onExit={() => setView('landing')} onSignUp={() => openLogin('signup')} />
      </Suspense>
    )
  }
  if (view === 'login') {
    return (
      <Login
        initialMode={loginMode}
        onBack={() => setView('landing')}
        onExploreDemo={() => setView('demo')}
      />
    )
  }
  return (
    <Landing
      onGetStarted={() => openLogin('signup')}
      onSignIn={() => openLogin('signin')}
      onExploreDemo={() => setView('demo')}
    />
  )
}

function FullScreenMessage({ text }) {
  return <div className="min-h-screen flex items-center justify-center text-text-muted text-sm">{text}</div>
}

// Lightweight placeholder shown while a lazily-loaded tab chunk is fetched.
function TabSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-32 rounded-xl bg-border" />
      <div className="h-48 rounded-xl bg-border" />
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
