// Thin wrapper around Plaid's REST API using plain fetch, so we don't need
// to bundle the Plaid Node SDK into a Deno Edge Function.

import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding/base64'

// Pure classifier lives in its own Deno-free module so vitest can unit-test it.
// Re-exported here so callers keep importing classifyKind from '_shared/plaid.ts'.
export { classifyKind } from './classify.ts'
export type { PlaidTxnLike, AccountLike } from './classify.ts'

const PLAID_ENV = Deno.env.get('PLAID_ENV') ?? 'sandbox'
const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID')
const PLAID_SECRET = Deno.env.get('PLAID_SECRET')

const PLAID_HOST: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
}

// ---------------------------------------------------------------------------
// Access-token encryption (AES-GCM via Web Crypto)
//
// Plaid access tokens are long-lived credentials to a user's bank. We store
// them encrypted at rest so a raw dump of plaid_items can't reveal a usable
// token. The key lives ONLY as the TOKEN_ENCRYPTION_KEY edge secret (a 32-byte
// key, base64-encoded) — never in the database or the frontend.
//
// Stored format: "v1:<iv base64>:<ciphertext base64>". The "v1:" prefix both
// versions the scheme (for future key rotation) and lets decryptToken tell an
// encrypted value apart from a legacy plaintext token during the back-fill
// window, so functions keep working whether or not a row is encrypted yet.
// ---------------------------------------------------------------------------

const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')
let cachedCryptoKey: CryptoKey | null = null

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey
  if (!TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      'Missing TOKEN_ENCRYPTION_KEY secret on this Supabase project — required to read/write bank tokens.',
    )
  }
  const raw = decodeBase64(TOKEN_ENCRYPTION_KEY)
  if (raw.byteLength !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded.')
  }
  cachedCryptoKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
  return cachedCryptoKey
}

// Encrypts a plaintext access token for storage in plaid_items.access_token_enc.
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  )
  return `v1:${encodeBase64(iv)}:${encodeBase64(ciphertext)}`
}

// Decrypts a stored value. A value without the "v1:" prefix is treated as a
// legacy plaintext token (returned as-is) so we degrade gracefully for any row
// not yet back-filled. Once 0011 drops the plaintext column this path is dead.
export async function decryptToken(stored: string): Promise<string> {
  if (!stored.startsWith('v1:')) return stored
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Malformed encrypted access token.')
  const key = await getEncryptionKey()
  const iv = decodeBase64(parts[1])
  const ciphertext = decodeBase64(parts[2])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )
  return new TextDecoder().decode(plaintext)
}

// Resolves the usable plaintext token from a plaid_items row, preferring the
// encrypted column and falling back to any legacy plaintext during the
// back-fill window. Callers pass the token to Plaid, never store it.
export async function resolveAccessToken(
  item: { access_token_enc?: string | null; access_token?: string | null },
): Promise<string> {
  if (item.access_token_enc) return decryptToken(item.access_token_enc)
  if (item.access_token) return item.access_token
  throw new Error('Bank connection has no stored access token.')
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

