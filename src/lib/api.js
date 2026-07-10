import { supabase } from './supabaseClient'
import { todayISO } from './dateHelpers'

const DEFAULT_CATEGORIES = [
  { name: 'Groceries', kind: 'expense' },
  { name: 'Dining & Restaurants', kind: 'expense' },
  { name: 'Transportation', kind: 'expense' },
  { name: 'Housing & Rent', kind: 'expense' },
  { name: 'Utilities', kind: 'expense' },
  { name: 'Health & Medical', kind: 'expense' },
  { name: 'Entertainment', kind: 'expense' },
  { name: 'Shopping', kind: 'expense' },
  { name: 'Salary', kind: 'income' },
  { name: 'Other Income', kind: 'income' },
]

// ---------- categories ----------

export async function fetchCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('name')
  if (error) throw error
  return data
}

export async function ensureDefaultCategories(userId) {
  const existing = await fetchCategories()
  if (existing.length > 0) return existing

  const rows = DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: userId }))
  const { data, error } = await supabase.from('categories').insert(rows).select()
  if (error) throw error
  return data
}

// Deletes ALL of the user's current categories and re-creates the default set.
// Destructive: because categories cascade in the DB, this also clears their
// budgets and merchant rules, and un-tags any transactions that used them.
export async function resetCategoriesToDefaults(userId) {
  const existing = await fetchCategories()
  if (existing.length > 0) {
    const { error: delError } = await supabase
      .from('categories')
      .delete()
      .in('id', existing.map((c) => c.id))
    if (delError) throw delError
  }
  const rows = DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: userId }))
  const { data, error } = await supabase.from('categories').insert(rows).select()
  if (error) throw error
  return data
}

export async function createCategory({ name, kind }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, kind, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCategory(id, updates) {
  const { data, error } = await supabase.from('categories').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

// ---------- transactions ----------

export async function fetchTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, category:categories(id, name, kind)')
    .order('date', { ascending: false })
  if (error) throw error
  return data
}

export async function createTransaction({ date, amount, kind, categoryId, note }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      date,
      amount,
      kind,
      category_id: categoryId || null,
      note: note || null,
      user_id: user.id,
      source: 'manual',
    })
    .select('*, category:categories(id, name, kind)')
    .single()
  if (error) throw error
  return data
}

export async function updateTransaction(id, updates) {
  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .select('*, category:categories(id, name, kind)')
    .single()
  if (error) throw error
  return data
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

// ---------- goals ----------

export async function fetchGoals() {
  const { data, error } = await supabase.from('goals').select('*').order('created_at')
  if (error) throw error
  return data
}

export async function createGoal({ name, targetAmount, currentAmount }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('goals')
    .insert({
      name,
      target_amount: targetAmount,
      current_amount: currentAmount || 0,
      user_id: user.id,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateGoal(id, updates) {
  const { data, error } = await supabase.from('goals').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw error
}

// ---------- merchant rules (auto-categorization) ----------

export async function fetchMerchantRules() {
  const { data, error } = await supabase.from('merchant_rules').select('*')
  if (error) throw error
  return data
}

export async function upsertMerchantRule(merchantKey, categoryId) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('merchant_rules')
    .upsert(
      { user_id: user.id, merchant_key: merchantKey, category_id: categoryId },
      { onConflict: 'user_id,merchant_key' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMerchantRule(id) {
  const { error } = await supabase.from('merchant_rules').delete().eq('id', id)
  if (error) throw error
}

// ---------- recurring overrides (subscription curation) ----------

// Per-merchant user curation of the recurring-charge detection (migration
// 0019). Keyed by (user_id, merchant_key). status is 'confirmed' | 'not_recurring';
// nickname is an optional friendly display name. Callers degrade to [] until run.
export async function fetchRecurringOverrides() {
  const { data, error } = await supabase.from('recurring_overrides').select('*')
  if (error) throw error
  return data
}

export async function upsertRecurringOverride(merchantKey, { status, nickname }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('recurring_overrides')
    .upsert(
      {
        user_id: user.id,
        merchant_key: merchantKey,
        status,
        nickname: nickname === '' || nickname == null ? null : nickname,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,merchant_key' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRecurringOverride(merchantKey) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('recurring_overrides')
    .delete()
    .eq('user_id', user.id)
    .eq('merchant_key', merchantKey)
  if (error) throw error
}

// ---------- budgets ----------

export async function fetchBudgets() {
  const { data, error } = await supabase.from('budgets').select('*')
  if (error) throw error
  return data
}

export async function upsertBudget(categoryId, amount) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('budgets')
    .upsert(
      { user_id: user.id, category_id: categoryId, amount },
      { onConflict: 'user_id,category_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBudget(categoryId) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('budgets')
    .delete()
    .eq('user_id', user.id)
    .eq('category_id', categoryId)
  if (error) throw error
}

// ---------- foods (meal tracker library) ----------

export async function fetchFoods() {
  const { data, error } = await supabase.from('foods').select('*').order('name')
  if (error) throw error
  return data
}

export async function createFood({
  name,
  servingDesc,
  calories,
  protein,
  carbs,
  fat,
  cost,
  fdcId,
  nutrients,
  source,
  sourceRef,
  aliases,
  brand,
  isStack,
  grade,
  upc,
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('foods')
    .insert({
      user_id: user.id,
      name,
      serving_desc: servingDesc || null,
      calories: calories || 0,
      protein: protein || 0,
      carbs: carbs || 0,
      fat: fat || 0,
      cost: cost === '' || cost == null ? null : cost,
      fdc_id: fdcId || null,
      // Full micronutrient profile (USDA) or ingredient list (supplement scan),
      // kept for a future micronutrient feature. Null for hand-entered foods.
      nutrients: nutrients ?? null,
      // Let the DB default ('manual') stand when the caller doesn't say.
      ...(source ? { source } : {}),
      // Provenance URL for web-sourced foods (migration 0023); omit otherwise so
      // the column stays null.
      ...(sourceRef ? { source_ref: sourceRef } : {}),
      // Short spoken names ("eggs", "my eggs") the assistant/search resolve on
      // (migration 0023). Only send when provided so the DB default ('{}') stands.
      ...(Array.isArray(aliases) && aliases.length ? { aliases: normalizeAliases(aliases) } : {}),
      // The maker, kept separate from `name` so the UI can show it on its own
      // line (migration 0024). Omit when blank so the column stays null.
      ...(brand && String(brand).trim() ? { brand: String(brand).trim() } : {}),
      // Only send is_stack when the caller opts in, so the DB default (false)
      // stands otherwise.
      ...(isStack ? { is_stack: true } : {}),
      // Quality tier of the base food (grass-fed, pasture-raised, wild…) —
      // migration 0026. Nullable free-text id from src/lib/gradeProfiles.js.
      ...(grade ? { grade } : {}),
      // Product barcode for scanned foods (migration 0027), so a re-scan finds
      // this row instead of creating a duplicate. Omit when absent.
      ...(upc && String(upc).trim() ? { upc: String(upc).trim() } : {}),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Normalize an alias list for storage: trim, lowercase, drop blanks, dedupe.
// Aliases are matched case-insensitively, so storing them lowercased keeps the
// resolution code simple and the stored data tidy.
export function normalizeAliases(aliases) {
  const seen = new Set()
  const out = []
  for (const a of aliases ?? []) {
    const clean = String(a ?? '').trim().toLowerCase()
    if (clean && !seen.has(clean)) {
      seen.add(clean)
      out.push(clean)
    }
  }
  return out
}

// Searches the USDA FoodData Central database via the `food-search` edge
// function (which holds the API key). Returns a trimmed list of matches, each
// with per-100g macros and an `fdcId`. Returns [] on empty/short queries.
// Cost is deliberately not part of this — pricing stays user-entered.
export async function searchFoods(query) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('food-search', {
    body: { query },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  if (error) {
    // functions.invoke hides the real message on non-2xx — dig it out.
    let message = error.message
    try {
      const body = await error.context.json()
      if (body?.error) message = body.error
    } catch {
      // fall back to the generic message
    }
    throw new Error(message)
  }
  return data?.foods ?? []
}

// Fetches one USDA food's per-100g macros plus its real-world portions (e.g.
// "1 large" egg = 50 g), so the meal tracker can let the user pick a unit and
// rescale macros. Same `food-search` edge function, detail mode.
export async function getFoodDetails(fdcId) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('food-search', {
    body: { fdcId },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  if (error) {
    let message = error.message
    try {
      const body = await error.context.json()
      if (body?.error) message = body.error
    } catch {
      // fall back to the generic message
    }
    throw new Error(message)
  }
  return data?.food ?? null
}

// Resolve a scanned product barcode (UPC/EAN) to a food via the `barcode-lookup`
// edge function (Open Food Facts first, then USDA branded by gtinUpc). Returns
// { found, source, product } — product has per-100g macros + a per-100g
// `nutrients` array + serving info, mirroring getFoodDetails so the verify-
// before-save UI can reuse the same scaling. Returns { found: false } on a miss.
export async function lookupBarcode(upc) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('barcode-lookup', {
    body: { upc },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  if (error) {
    let message = error.message
    try {
      const body = await error.context.json()
      if (body?.error) message = body.error
    } catch {
      // fall back to the generic message
    }
    throw new Error(message)
  }
  return data ?? { found: false }
}

export async function updateFood(id, updates) {
  const { data, error } = await supabase.from('foods').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteFood(id) {
  const { error } = await supabase.from('foods').delete().eq('id', id)
  if (error) throw error
}

// ---------- food logs ----------

export async function fetchFoodLogs() {
  const { data, error } = await supabase.from('food_logs').select('*').order('date', { ascending: false })
  if (error) throw error
  return data
}

export async function createFoodLog({ date, meal, foodId, name, servings, calories, protein, carbs, fat, cost, transactionId, templateId }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('food_logs')
    .insert({
      user_id: user.id,
      food_id: foodId || null,
      date,
      // null meal = uncategorized (see migration 0017).
      meal: meal ?? null,
      name,
      servings: servings || 1,
      calories: calories || 0,
      protein: protein || 0,
      carbs: carbs || 0,
      fat: fat || 0,
      cost: cost == null ? null : cost,
      // The bank charge this meal was paid with (0018). Null for home meals or
      // when no matching transaction was found.
      transaction_id: transactionId || null,
      // The meal template that produced this log (0028), if any. Lets the app
      // tell "already logged my usual breakfast today".
      template_id: templateId || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateFoodLog(id, updates) {
  const { data, error } = await supabase.from('food_logs').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteFoodLog(id) {
  const { error } = await supabase.from('food_logs').delete().eq('id', id)
  if (error) throw error
}

// ---------- meal templates (saved "usual" meals, migration 0028) ----------

export async function fetchMealTemplates() {
  const { data, error } = await supabase
    .from('meal_templates')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createMealTemplate({ name, meal, items, scheduledDays, autoLog }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('meal_templates')
    .insert({
      user_id: user.id,
      name,
      meal: meal ?? null,
      items: items ?? [],
      scheduled_days: scheduledDays ?? [],
      auto_log: !!autoLog,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMealTemplate(id, updates) {
  const { data, error } = await supabase
    .from('meal_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMealTemplate(id) {
  const { error } = await supabase.from('meal_templates').delete().eq('id', id)
  if (error) throw error
}

// ---------- nutrition targets ----------

export async function fetchNutritionTargets() {
  const { data, error } = await supabase.from('nutrition_targets').select('*').maybeSingle()
  if (error) throw error
  return data
}

// Upsert the user's targets. Every field is written only when the caller passes
// it, so a macro-only save (the macro editor) doesn't clobber micronutrient
// settings and a micro-only save (the micronutrient editor) doesn't zero the
// macros. On the very first insert, omitted columns fall back to the DB defaults
// (0 macros, '{}' micro_targets, 'neutral' sex). microTargets replaces the whole
// override map.
export async function upsertNutritionTargets({ calories, protein, carbs, fat, microTargets, sex }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const row = { user_id: user.id, updated_at: new Date().toISOString() }
  if (calories !== undefined) row.calories = calories || 0
  if (protein !== undefined) row.protein = protein || 0
  if (carbs !== undefined) row.carbs = carbs || 0
  if (fat !== undefined) row.fat = fat || 0
  if (microTargets !== undefined) row.micro_targets = microTargets ?? {}
  if (sex !== undefined) row.sex = sex || 'neutral'
  const { data, error } = await supabase
    .from('nutrition_targets')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ---------- assistant memory ----------

export async function fetchMemories() {
  const { data, error } = await supabase.from('assistant_memories').select('*').order('created_at')
  if (error) throw error
  return data
}

export async function createMemory(content) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('assistant_memories')
    .insert({ user_id: user.id, content })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMemory(id) {
  const { error } = await supabase.from('assistant_memories').delete().eq('id', id)
  if (error) throw error
}

// ---------- credit scores (manual log) ----------

export async function fetchCreditScores() {
  const { data, error } = await supabase
    .from('credit_scores')
    .select('*')
    .order('recorded_on', { ascending: true })
  if (error) throw error
  return data
}

export async function createCreditScore({ score, source, recordedOn, note }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('credit_scores')
    .insert({
      user_id: user.id,
      score,
      source: source || null,
      recorded_on: recordedOn || todayISO(),
      note: note || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCreditScore(id) {
  const { error } = await supabase.from('credit_scores').delete().eq('id', id)
  if (error) throw error
}

// ---------- receipts (itemized receipt scanning) ----------

// Fetches the user's itemized receipts with their line items nested (and each
// item's linked food name, when mapped). Ordered newest first. RLS scopes this
// to the current user. Lives in migration 0016 — callers degrade to [] until run.
export async function fetchReceipts() {
  const { data, error } = await supabase
    .from('receipts')
    .select('*, items:receipt_items(*, food:foods(id, name))')
    .order('purchase_date', { ascending: false })
  if (error) throw error
  return data
}

export async function createReceipt({ storeName, purchaseDate, total, matchedTransactionId }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('receipts')
    .insert({
      user_id: user.id,
      store_name: storeName || null,
      purchase_date: purchaseDate || null,
      total: total === '' || total == null ? null : total,
      matched_transaction_id: matchedTransactionId || null,
    })
    .select('*, items:receipt_items(*, food:foods(id, name))')
    .single()
  if (error) throw error
  return data
}

export async function updateReceipt(id, updates) {
  const { data, error } = await supabase
    .from('receipts')
    .update(updates)
    .eq('id', id)
    .select('*, items:receipt_items(*, food:foods(id, name))')
    .single()
  if (error) throw error
  return data
}

// Batch-inserts a receipt's line items. `items` are the normalized drafts from
// parseReceiptItemized (plus the user's is_food decision). Returns the saved
// rows (with ids) so the mapping step can update food_id per item.
export async function createReceiptItems(receiptId, items) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const rows = items.map((it) => ({
    receipt_id: receiptId,
    user_id: user.id,
    raw_name: it.raw_name,
    price: it.price == null || it.price === '' ? null : it.price,
    quantity: it.quantity == null || it.quantity === '' ? null : it.quantity,
    unit: it.unit || null,
    is_food: it.is_food !== false,
    food_id: it.food_id || null,
  }))
  const { data, error } = await supabase
    .from('receipt_items')
    .insert(rows)
    .select('*, food:foods(id, name)')
  if (error) throw error
  return data
}

export async function updateReceiptItem(id, updates) {
  const { data, error } = await supabase
    .from('receipt_items')
    .update(updates)
    .eq('id', id)
    .select('*, food:foods(id, name)')
    .single()
  if (error) throw error
  return data
}

// ---------- receipt item rules (raw item text -> food memory) ----------

export async function fetchReceiptItemRules() {
  const { data, error } = await supabase.from('receipt_item_rules').select('*')
  if (error) throw error
  return data
}

export async function upsertReceiptItemRule(itemKey, foodId) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('receipt_item_rules')
    .upsert(
      { user_id: user.id, item_key: itemKey, food_id: foodId },
      { onConflict: 'user_id,item_key' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// ---------- transfer pairs (linked credit-card-payment / transfer legs) ----------

// A transfer_pair (migration 0029) LINKS the two legs of one internal money
// move so the UI shows them as one row. It never merges/edits the underlying
// transactions. Callers degrade to [] until the migration is run.
export async function fetchTransferPairs() {
  const { data, error } = await supabase.from('transfer_pairs').select('*')
  if (error) throw error
  return data
}

export async function createTransferPair({ transactionA, transactionB, status = 'auto' }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transfer_pairs')
    .insert({
      user_id: user.id,
      transaction_a: transactionA,
      transaction_b: transactionB,
      status,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Unpairing is just deleting the link row — both transactions are untouched.
export async function deleteTransferPair(id) {
  const { error } = await supabase.from('transfer_pairs').delete().eq('id', id)
  if (error) throw error
}

// ---------- plaid ----------

export async function fetchPlaidConnections() {
  const { data, error } = await supabase.rpc('get_plaid_connections')
  if (error) throw error
  return data
}

// Per-account balances (checking, savings, etc.) — non-sensitive columns only,
// via the SECURITY DEFINER function get_plaid_accounts.
export async function fetchPlaidAccounts() {
  const { data, error } = await supabase.rpc('get_plaid_accounts')
  if (error) throw error
  return data
}

// ---------- notification preferences (weekly digest) ----------

// One row per user (migration 0015). A missing row means defaults (digest on),
// so callers treat null as "enabled" — matching the edge function's behavior.
export async function fetchNotificationPrefs() {
  const { data, error } = await supabase.from('notification_prefs').select('*').maybeSingle()
  if (error) throw error
  return data
}

export async function upsertNotificationPrefs({ weeklyDigest, emailOverride }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('notification_prefs')
    .upsert(
      {
        user_id: user.id,
        weekly_digest: weeklyDigest,
        email_override: emailOverride === '' || emailOverride == null ? null : emailOverride,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// ---------- weekly digest (in-app card) ----------

// The most recent digest the user hasn't dismissed, shown as a Dashboard card.
// Returns null when there's none (RLS scopes this to the current user).
export async function fetchLatestDigest() {
  const { data, error } = await supabase
    .from('digests')
    .select('id, week_start, subject, summary, sections, dismissed, created_at')
    .eq('dismissed', false)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function dismissDigest(id) {
  const { error } = await supabase.from('digests').update({ dismissed: true }).eq('id', id)
  if (error) throw error
}

// ---------- entitlements (free vs. pro) ----------

// The single source of truth for the current user's plan. get_entitlements
// always returns exactly one row: { plan: 'free'|'pro', status, period_end }.
export async function fetchEntitlements() {
  const { data, error } = await supabase.rpc('get_entitlements')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ?? { plan: 'free', status: null, period_end: null }
}
