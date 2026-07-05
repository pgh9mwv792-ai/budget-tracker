import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { plaidFetch, resolveAccessToken } from '../_shared/plaid.ts'
import { logError } from '../_shared/log-error.ts'

// Disconnects a linked bank: tells Plaid to remove the Item (which stops any
// further access and frees the connection on Plaid's side), then deletes our
// stored record. Imported transactions are intentionally LEFT in place so the
// user keeps their history — removing the bank only stops future syncing.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    const { id } = await req.json()
    if (!id) throw new Error('Missing bank id')

    const supabase = getServiceClient()

    // Look up the row, but only if it belongs to the calling user — this is
    // what stops one user from removing another user's bank.
    const { data: item, error: findErr } = await supabase
      .from('plaid_items')
      .select('id, item_id, access_token_enc, access_token')
      .eq('id', id)
      .eq('user_id', userId)
      .single()
    if (findErr || !item) throw new Error('Bank connection not found.')

    // Ask Plaid to remove the Item. If Plaid errors (e.g. already removed),
    // don't block the user from clearing it on our side — we still delete our
    // record below so the bank disappears from their list.
    try {
      await plaidFetch('/item/remove', { access_token: await resolveAccessToken(item) })
    } catch (_e) {
      // swallow — proceed to delete our record regardless
    }

    // Clear the stored balances for this bank's accounts too.
    await supabase
      .from('plaid_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('item_id', item.item_id)

    const { error: delErr } = await supabase
      .from('plaid_items')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (delErr) throw delErr

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('plaid-remove-item', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
