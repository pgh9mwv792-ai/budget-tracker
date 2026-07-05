import { getServiceClient } from '../_shared/auth.ts'
import { verifyStripeEvent, stripeGet } from '../_shared/stripe.ts'
import { logError } from '../_shared/log-error.ts'

// Stripe -> our app webhook. Stripe calls this UNAUTHENTICATED, so this function
// must be deployed with --no-verify-jwt (see supabase/config.toml). Instead of a
// Supabase JWT, we trust the Stripe-Signature header, verified against
// STRIPE_WEBHOOK_SECRET. On the events below we upsert the user's subscriptions
// row, which is what actually flips them between free and pro.
//
// No CORS headers here: this endpoint is server-to-server (Stripe), never
// called from a browser.
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')

Deno.serve(async (req) => {
  try {
    // Signature verification needs the exact raw bytes, so read text (never
    // req.json()) before parsing.
    const rawBody = await req.text()
    const event = await verifyStripeEvent(rawBody, req.headers.get('Stripe-Signature'), WEBHOOK_SECRET)

    const supabase = getServiceClient()

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.client_reference_id ?? session.metadata?.user_id
        // The session doesn't carry period end / status, so fetch the freshly
        // created subscription for the full picture, then upsert.
        if (session.subscription) {
          const sub = await stripeGet(`subscriptions/${session.subscription}`)
          await upsertSubscription(supabase, sub, userId)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // The object IS the subscription here (has status + current_period_end).
        await upsertSubscription(supabase, event.data.object, event.data.object.metadata?.user_id)
        break
      }
      default:
        // Ignore everything else — we only care about subscription lifecycle.
        break
    }

    // Always 200 on a well-formed, verified event so Stripe stops retrying.
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // A verification failure or handler error returns non-2xx so Stripe retries.
    const message = logError('stripe-webhook', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// Writes a Stripe subscription object into our subscriptions table. Resolves the
// owning user from the subscription metadata first, then falls back to matching
// the Stripe customer id to a row we already stored at checkout.
async function upsertSubscription(supabase: any, sub: any, userIdHint?: string | null) {
  let userId = userIdHint ?? null
  if (!userId && sub.customer) {
    const { data } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', sub.customer)
      .maybeSingle()
    userId = data?.user_id ?? null
  }
  if (!userId) {
    throw new Error(`Could not resolve app user for Stripe subscription ${sub.id}`)
  }

  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null

  const { error } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: sub.customer ?? null,
      stripe_subscription_id: sub.id ?? null,
      status: sub.status ?? null,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}
