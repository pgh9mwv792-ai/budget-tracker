import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { stripePost } from '../_shared/stripe.ts'
import { logError } from '../_shared/log-error.ts'

// Creates a Stripe Checkout Session (subscription mode) for the logged-in user
// and returns its hosted URL. The frontend redirects the browser there; when
// payment completes Stripe fires the webhook that actually grants Pro.
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    if (!PRICE_ID) {
      throw new Error('Missing STRIPE_PRICE_ID secret. Run: supabase secrets set STRIPE_PRICE_ID=price_...')
    }

    // The app tells us where to send the browser back to (its own origin), so
    // this works from localhost and production without hardcoding a URL.
    const { origin } = await req.json().catch(() => ({ origin: null }))
    const baseUrl = origin || 'https://budget-tracker-rose-mu.vercel.app'

    const supabase = getServiceClient()

    // Reuse this user's Stripe customer if we've made one before, so they don't
    // pile up duplicate customers across checkout attempts.
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    let customerId = existing?.stripe_customer_id ?? null
    if (!customerId) {
      const { data: userRes } = await supabase.auth.admin.getUserById(userId)
      const customer = await stripePost('customers', {
        email: userRes?.user?.email ?? undefined,
        metadata: { user_id: userId },
      })
      customerId = customer.id
      // Remember the customer id now (status left null => still free until the
      // subscription webhook arrives). Upsert so we never clobber an existing row.
      await supabase
        .from('subscriptions')
        .upsert(
          { user_id: userId, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
    }

    const session = await stripePost('checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      // Stamp the user id onto the subscription so the webhook can attribute
      // subscription.updated / .deleted events back to the right account.
      subscription_data: { metadata: { user_id: userId } },
      success_url: `${baseUrl}/?billing=success`,
      cancel_url: `${baseUrl}/?billing=cancel`,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('stripe-create-checkout', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
