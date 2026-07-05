import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { plaidFetch, syncAccounts, encryptToken } from '../_shared/plaid.ts'
import { logError } from '../_shared/log-error.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    const { public_token, institution_name } = await req.json()
    if (!public_token) throw new Error('Missing public_token')

    const data = await plaidFetch('/item/public_token/exchange', { public_token })

    const supabase = getServiceClient()
    // Store the token encrypted at rest. New rows keep access_token null — only
    // the encrypted column is written from here on.
    const { error } = await supabase.from('plaid_items').insert({
      user_id: userId,
      item_id: data.item_id,
      access_token_enc: await encryptToken(data.access_token),
      institution_name: institution_name ?? null,
    })
    if (error) throw error

    // Pull the account list (checking, savings, etc.) right away so balances
    // show immediately, before the first transaction sync. Best-effort.
    try {
      await syncAccounts(supabase, userId, data.access_token)
    } catch (_e) {
      // ignore — the next sync will populate accounts
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('plaid-exchange-public-token', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
