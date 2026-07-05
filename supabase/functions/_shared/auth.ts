import { createClient } from 'jsr:@supabase/supabase-js@2'

// Edge Functions get these automatically from the Supabase platform — you
// do not need to set them yourself as secrets.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Validates the caller's JWT (from the Authorization header) and returns
// their user id. Uses the anon key + the caller's own token, so this
// respects auth like a normal client call would.
export async function getUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Missing Authorization header')

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user) throw new Error('Invalid or expired session')
  return user.id
}

// Service-role client that bypasses RLS. Only used server-side, and only
// after getUserId() has confirmed who the caller is — every query below
// still filters by that verified user_id explicitly.
export function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}
