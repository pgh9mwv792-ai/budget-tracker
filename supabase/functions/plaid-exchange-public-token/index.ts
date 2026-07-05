import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { plaidFetch } from '../_shared/plaid.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    const { public_token, institution_name } = await req.json()
    if (!public_token) throw new Error('Missing public_token')

    const data = await plaidFetch('/item/public_token/exchange', { public_token })

    const supabase = getServiceClient()
    const { error } = await supabase.from('plaid_items').insert({
      user_id: userId,
      item_id: data.item_id,
      access_token: data.access_token,
      institution_name: institution_name ?? null,
    })
    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
