// Server-side entitlement check. The frontend hides paid features, but we never
// trust the client — the cost-scaling functions (chat, Plaid) call getPlan()
// with the service-role client to confirm the caller is actually Pro before
// doing paid work.
//
// Fails OPEN if the subscriptions table can't be read (e.g. migration 0012 not
// applied yet): mirrors how the chat function's ai_usage check degrades, so an
// un-run migration never bricks the app for the grandfathered owner. Once the
// table exists, a user with no row (or an expired/canceled one) resolves to
// 'free' and gets gated normally.

export type Plan = 'free' | 'pro'

export async function getPlan(supabase: any, userId: string): Promise<Plan> {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.warn('entitlement check skipped:', error.message)
      return 'pro' // fail open — see note above
    }
    return planFromRow(data)
  } catch (e) {
    console.warn('entitlement check errored, allowing:', (e as Error).message)
    return 'pro'
  }
}

function planFromRow(row: { status?: string | null; current_period_end?: string | null } | null): Plan {
  if (!row) return 'free'
  if (row.status === 'grandfathered') return 'pro'
  if (
    (row.status === 'active' || row.status === 'trialing') &&
    (!row.current_period_end || new Date(row.current_period_end) > new Date())
  ) {
    return 'pro'
  }
  return 'free'
}

// Standard 402 body for a free user hitting a Pro-only feature.
export function paywallResponse(corsHeaders: Record<string, string>, feature: string): Response {
  return new Response(
    JSON.stringify({
      error: `${feature} is a Pro feature. Upgrade in Settings → Plan & billing to turn it on.`,
    }),
    { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}
