import { supabase } from './supabaseClient'

// Calls a billing edge function and returns its JSON. Mirrors the error-digging
// pattern used elsewhere: supabase.functions.invoke hides the function's body on
// a non-2xx response, so we pull the real message out of error.context.
async function callFunction(name, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    let message = error.message
    try {
      const details = await error.context.json()
      if (details?.error) message = details.error
    } catch {
      // keep the fallback message
    }
    throw new Error(message)
  }
  return data
}

// Starts Stripe Checkout and redirects the browser to the hosted payment page.
// Passes our own origin so success/cancel come back to this same deployment.
export async function startCheckout() {
  const { url } = await callFunction('stripe-create-checkout', { origin: window.location.origin })
  if (url) window.location.href = url
}

// Opens the Stripe Billing Portal (manage / cancel) in the same tab.
export async function openBillingPortal() {
  const { url } = await callFunction('stripe-portal', { origin: window.location.origin })
  if (url) window.location.href = url
}
