import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { stripePost } from '../_shared/stripe.ts'
import { logError } from '../_shared/log-error.ts'

// Creates a Stripe Billing Portal session so the user can manage or cancel
// their subscription. Requires an existing Stripe customer (created during
// checkout); returns the portal URL for the frontend to redirect to.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    const { origin } = await req.json().catch(() => ({ origin: null }))
    const baseUrl = origin || 'https://budget-tracker-rose-mu.vercel.app'

    const supabase = getServiceClient()
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      throw new Error("You don't have a billing account yet. Subscribe first, then you can manage it here.")
    }

    const session = await stripePost('billing_portal/sessions', {
      customer: sub.stripe_customer_id,
      return_url: `${baseUrl}/?billing=portal`,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('stripe-portal', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
