// Thin wrapper around Plaid's REST API using plain fetch, so we don't need
// to bundle the Plaid Node SDK into a Deno Edge Function.

const PLAID_ENV = Deno.env.get('PLAID_ENV') ?? 'sandbox'
const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID')
const PLAID_SECRET = Deno.env.get('PLAID_SECRET')

const PLAID_HOST: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
}

export async function plaidFetch(path: string, body: Record<string, unknown>) {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error('Missing PLAID_CLIENT_ID / PLAID_SECRET secrets on this Supabase project.')
  }

  const res = await fetch(`${PLAID_HOST[PLAID_ENV]}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      ...body,
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error_message ?? `Plaid request to ${path} failed`)
  }
  return data
}
