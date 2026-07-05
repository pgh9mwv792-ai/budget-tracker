import { corsHeaders } from '../_shared/cors.ts'
import { getUserId } from '../_shared/auth.ts'
import { plaidFetch } from '../_shared/plaid.ts'
import { logError } from '../_shared/log-error.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)

    const data = await plaidFetch('/link/token/create', {
      user: { client_user_id: userId },
      client_name: 'Budget Tracker',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    })

    return new Response(JSON.stringify({ link_token: data.link_token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('plaid-create-link-token', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
