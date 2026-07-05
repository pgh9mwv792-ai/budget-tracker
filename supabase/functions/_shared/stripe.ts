// Thin wrapper around Stripe's REST API using plain fetch, so we don't need to
// bundle the Stripe Node SDK into a Deno Edge Function (same approach as
// _shared/plaid.ts). Stripe's API takes application/x-www-form-urlencoded
// bodies with bracketed keys for nested data, e.g. line_items[0][price]=...

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')
const STRIPE_API = 'https://api.stripe.com/v1'

// Flattens a nested object into Stripe's bracket-notation form encoding.
//   { line_items: [{ price: 'x', quantity: 1 }] }
//   -> line_items[0][price]=x & line_items[0][quantity]=1
function toForm(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const pairs: [string, string][] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    const field = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object' && v !== null) {
          pairs.push(...toForm(v as Record<string, unknown>, `${field}[${i}]`))
        } else {
          pairs.push([`${field}[${i}]`, String(v)])
        }
      })
    } else if (typeof value === 'object') {
      pairs.push(...toForm(value as Record<string, unknown>, field))
    } else {
      pairs.push([field, String(value)])
    }
  }
  return pairs
}

// POST to a Stripe endpoint (create checkout session, portal session, etc.).
export async function stripePost(path: string, body: Record<string, unknown>) {
  if (!STRIPE_SECRET_KEY) {
    throw new Error(
      'Missing STRIPE_SECRET_KEY secret on this Supabase project. Run: supabase secrets set STRIPE_SECRET_KEY=sk_...',
    )
  }
  const form = new URLSearchParams(toForm(body))
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe request to ${path} failed`)
  }
  return data
}

// GET a Stripe object by path (e.g. subscriptions/sub_123).
export async function stripeGet(path: string) {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY secret on this Supabase project.')
  }
  const res = await fetch(`${STRIPE_API}/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe request to ${path} failed`)
  }
  return data
}

// ---------------------------------------------------------------------------
// Webhook signature verification.
//
// Stripe signs each webhook with the endpoint's signing secret (whsec_...).
// The Stripe-Signature header looks like: "t=1615...,v1=hex,v1=hex". The signed
// payload is `${t}.${rawBody}`, HMAC-SHA256 with the secret, compared (constant
// time) against the v1 signatures. We verify this ourselves because the
// function is deployed with --no-verify-jwt (Stripe calls it unauthenticated),
// so the signature is our only proof the request is genuinely from Stripe.
// ---------------------------------------------------------------------------
export async function verifyStripeEvent(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
  toleranceSeconds = 300,
): Promise<any> {
  if (!secret) {
    throw new Error(
      'Missing STRIPE_WEBHOOK_SECRET secret. Run: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...',
    )
  }
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header')

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i), kv.slice(i + 1)]
    }),
  )
  const timestamp = parts['t']
  const provided = parts['v1']
  if (!timestamp || !provided) throw new Error('Malformed Stripe-Signature header')

  // Reject stale signatures to blunt replay attacks.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (age > toleranceSeconds) throw new Error('Stripe signature timestamp outside tolerance')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)),
  )
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')

  if (!timingSafeEqual(expected, provided)) {
    throw new Error('Stripe signature verification failed')
  }
  return JSON.parse(rawBody)
}

// Length-checked, constant-time-ish string compare so we don't leak how much of
// the signature matched via early exit.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
