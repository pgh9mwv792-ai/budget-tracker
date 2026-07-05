import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { plaidFetch } from '../_shared/plaid.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    const supabase = getServiceClient()

    const { data: items, error: itemsError } = await supabase
      .from('plaid_items')
      .select('id, item_id, access_token, cursor')
      .eq('user_id', userId)
    if (itemsError) throw itemsError

    let imported = 0

    for (const item of items ?? []) {
      let cursor = item.cursor ?? undefined
      let hasMore = true
      const added: any[] = []

      while (hasMore) {
        const page = await plaidFetch('/transactions/sync', {
          access_token: item.access_token,
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
          // Plaid convention: positive amount = money out (expense),
          // negative amount = money in (income/credit).
          kind: t.amount >= 0 ? 'expense' : 'income',
          note: t.name ?? null,
          source: 'plaid',
          plaid_transaction_id: t.transaction_id,
          category_id: null,
        }))

        const { error: upsertError } = await supabase
          .from('transactions')
          .upsert(rows, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true })
        if (upsertError) throw upsertError
        imported += rows.length
      }

      await supabase.from('plaid_items').update({ cursor }).eq('id', item.id)
    }

    return new Response(JSON.stringify({ ok: true, imported }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
