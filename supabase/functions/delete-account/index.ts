import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { logError } from '../_shared/log-error.ts'

// Permanently deletes the calling user's auth account. Because every table in
// this app has `user_id ... references auth.users(id) on delete cascade`,
// removing the auth user also removes all of their rows (transactions,
// categories, budgets, goals, foods, logs, memories, etc.). The browser can't
// do this itself — user deletion requires the service role — so it happens
// here, only for the already-authenticated caller's own id.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userId = await getUserId(req)
    const admin = getServiceClient()

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('delete-account', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
