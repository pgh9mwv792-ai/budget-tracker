import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import {
  plaidFetch,
  syncAccounts,
  classifyKind,
  isPayrollIncome,
  resolveAccessToken,
} from '../_shared/plaid.ts'
import { getPlan, paywallResponse } from '../_shared/entitlements.ts'
import { logError } from '../_shared/log-error.ts'

// Picks the category a payroll deposit should land in. Prefers a category the
// user literally named "Income", then "Salary", then any income-kind category —
// returns null (leave uncategorized) when the user has no income category at
// all, so we never invent one or guess wrong.
async function resolveIncomeCategoryId(
  supabase: any,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
    .eq('kind', 'income')
  const cats = data ?? []
  if (cats.length === 0) return null
  const byName = (re: RegExp) => cats.find((c: any) => re.test(String(c.name ?? '')))
  return (byName(/^income$/i) ?? byName(/salary/i) ?? cats[0]).id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)

    // Bank sync is a Pro feature — enforce server-side, never trust the UI.
    if ((await getPlan(getServiceClient(), userId)) !== 'pro') {
      return paywallResponse(corsHeaders, 'Syncing transactions')
    }

    // `full: true` re-pulls the entire history and re-classifies existing rows.
    // Used once after upgrading (so transfers that were previously imported as
    // income/expense get corrected) — normal syncs are incremental.
    let full = false
    try {
      const body = await req.json()
      full = body?.full === true
    } catch {
      // no body — incremental sync
    }

    const supabase = getServiceClient()

    const { data: items, error: itemsError } = await supabase
      .from('plaid_items')
      .select('id, item_id, access_token_enc, cursor')
      .eq('user_id', userId)
    if (itemsError) throw itemsError

    let imported = 0

    for (const item of items ?? []) {
      const accessToken = await resolveAccessToken(item)

      // Keep account balances fresh (checking/savings). Don't let a balance
      // hiccup block transaction syncing. We also keep each account's
      // type/subtype so classifyKind can recognize a credit-card payment's
      // receiving leg (a "PAYMENT THANK YOU" landing on the credit account).
      let accountsById = new Map<string, { type?: string | null; subtype?: string | null }>()
      try {
        const accts = await syncAccounts(supabase, userId, accessToken)
        accountsById = new Map(
          accts.map((a: any) => [a.account_id, { type: a.type, subtype: a.subtype }]),
        )
      } catch (_e) {
        // ignore — balances are best-effort; classification falls back to Plaid's
        // own category fields when we have no account context.
      }

      let cursor = full ? undefined : (item.cursor ?? undefined)
      let hasMore = true
      const added: any[] = []
      const modified: any[] = []
      const removedIds: string[] = []

      while (hasMore) {
        const page = await plaidFetch('/transactions/sync', {
          access_token: accessToken,
          cursor,
        })
        added.push(...(page.added ?? []))
        modified.push(...(page.modified ?? []))
        for (const r of page.removed ?? []) {
          if (r.transaction_id) removedIds.push(r.transaction_id)
        }
        cursor = page.next_cursor
        hasMore = page.has_more
      }

      // Both new and updated transactions are upserted. category_id is
      // deliberately omitted from the row shape so on-conflict updates only
      // refresh the Plaid-derived fields and never touch a category the user
      // (or a rule) assigned.
      const changed = [...added, ...modified]
      if (changed.length > 0) {
        const rows = changed.map((t) => ({
          user_id: userId,
          date: t.date,
          amount: Math.abs(t.amount),
          kind: classifyKind(t, accountsById.get(t.account_id)),
          note: t.name ?? null,
          source: 'plaid',
          plaid_transaction_id: t.transaction_id,
          account_id: t.account_id ?? null,
        }))

        const { error: upsertError } = await supabase
          .from('transactions')
          .upsert(rows, { onConflict: 'plaid_transaction_id' })
        if (upsertError) throw upsertError
        imported += added.length
      }

      // Carry categorization across the pending→posted handoff. When a pending
      // transaction posts, Plaid sends the posted row in `added` (with a NEW
      // transaction_id) referencing the pending one via pending_transaction_id,
      // and lists the pending row in `removed`. Copy the user's category and its
      // override flag onto the freshly-inserted posted row BEFORE the pending
      // row is deleted below, so a manual "Income" edit survives posting.
      for (const t of changed) {
        if (!t.pending_transaction_id) continue
        const { data: pred } = await supabase
          .from('transactions')
          .select('category_id, user_categorized')
          .eq('user_id', userId)
          .eq('plaid_transaction_id', t.pending_transaction_id)
          .maybeSingle()
        if (pred?.category_id) {
          await supabase
            .from('transactions')
            .update({ category_id: pred.category_id, user_categorized: pred.user_categorized ?? false })
            .eq('user_id', userId)
            .eq('plaid_transaction_id', t.transaction_id)
            .is('category_id', null)
        }
      }

      // Auto-categorize brand-new payroll/direct-deposit income as Income. The
      // `is('category_id', null)` + `user_categorized = false` guards mean this
      // only ever fills a still-blank, never-hand-edited row — so it categorizes
      // new paychecks without clobbering anything a human set.
      const payrollIds = added
        .filter((t) => isPayrollIncome(t, accountsById.get(t.account_id)))
        .map((t) => t.transaction_id)
      if (payrollIds.length > 0) {
        const incomeCatId = await resolveIncomeCategoryId(supabase, userId)
        if (incomeCatId) {
          await supabase
            .from('transactions')
            .update({ category_id: incomeCatId })
            .eq('user_id', userId)
            .in('plaid_transaction_id', payrollIds)
            .is('category_id', null)
            .eq('user_categorized', false)
        }
      }

      // Drop transactions Plaid no longer reports (including pending rows now
      // superseded by their posted successor above). Scoped to this user's
      // plaid_transaction_ids; manual rows have none and are never matched.
      if (removedIds.length > 0) {
        const { error: delError } = await supabase
          .from('transactions')
          .delete()
          .eq('user_id', userId)
          .in('plaid_transaction_id', removedIds)
        if (delError) throw delError
      }

      await supabase.from('plaid_items').update({ cursor }).eq('id', item.id)
    }

    return new Response(JSON.stringify({ ok: true, imported }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('plaid-sync-transactions', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
