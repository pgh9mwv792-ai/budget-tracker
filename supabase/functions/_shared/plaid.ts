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

// Pulls the latest balances + metadata for every account behind one linked
// bank (access_token) and upserts them into plaid_accounts. Called after
// linking and on every sync so checking/savings balances stay current.
// `supabase` is a service-role client (bypasses RLS); `userId` is the verified
// owner so we can never write another user's accounts.
export async function syncAccounts(
  supabase: any,
  userId: string,
  accessToken: string,
) {
  const data = await plaidFetch('/accounts/get', { access_token: accessToken })
  const itemId = data.item?.item_id ?? null
  const rows = (data.accounts ?? []).map((a: any) => ({
    user_id: userId,
    item_id: itemId,
    account_id: a.account_id,
    name: a.name ?? null,
    official_name: a.official_name ?? null,
    type: a.type ?? null,
    subtype: a.subtype ?? null,
    mask: a.mask ?? null,
    current_balance: a.balances?.current ?? null,
    available_balance: a.balances?.available ?? null,
    credit_limit: a.balances?.limit ?? null,
    iso_currency_code: a.balances?.iso_currency_code ?? null,
    updated_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase
      .from('plaid_accounts')
      .upsert(rows, { onConflict: 'account_id' })
    if (error) throw error
  }
  return rows
}

// Plaid's personal_finance_category marks internal money movements as
// TRANSFER_IN / TRANSFER_OUT. Those are moving your own money between accounts
// (e.g. savings -> checking), not real income or spending — so we tag them
// 'transfer' and they drop out of every income/expense total. Falls back to
// the legacy category array, then to the amount sign.
export function classifyKind(t: any): 'income' | 'expense' | 'transfer' {
  const primary = t.personal_finance_category?.primary
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT') return 'transfer'
  const legacy = Array.isArray(t.category) ? t.category : []
  if (legacy.some((c: string) => /transfer/i.test(c))) return 'transfer'
  // Plaid convention: positive amount = money out (expense),
  // negative amount = money in (income/credit).
  return t.amount >= 0 ? 'expense' : 'income'
}
