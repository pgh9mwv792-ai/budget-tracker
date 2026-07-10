import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { plaidFetch, syncAccounts, classifyKind, resolveAccessToken } from '../_shared/plaid.ts'
import { getPlan, paywallResponse } from '../_shared/entitlements.ts'
import { logError } from '../_shared/log-error.ts'

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

      while (hasMore) {
        const page = await plaidFetch('/transactions/sync', {
          access_token: accessToken,
          cursor,
        })
        added.push(...page.added)
        cursor = page.next_cursor
        hasMore = page.has_more
      }

      if (added.length > 0) {
        const rows = added.map((t) => ({
          user_id: userId,
          date: t.date,
          amount: Math.abs(t.amount),
          kind: classifyKind(t, accountsById.get(t.account_id)),
          note: t.name ?? null,
          source: 'plaid',
          plaid_transaction_id: t.transaction_id,
          account_id: t.account_id ?? null,
          // NOTE: category_id is deliberately omitted so re-syncing never wipes
          // a category the user assigned — on conflict we only refresh the
          // Plaid-derived fields below and leave category_id untouched.
        }))

        const { error: upsertError } = await supabase
          .from('transactions')
          .upsert(rows, { onConflict: 'plaid_transaction_id' })
        if (upsertError) throw upsertError
        imported += rows.length
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
