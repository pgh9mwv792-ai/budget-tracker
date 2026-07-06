import { corsHeaders } from '../_shared/cors.ts'
import { getUserId, getServiceClient } from '../_shared/auth.ts'
import { getPlan, paywallResponse } from '../_shared/entitlements.ts'
import { logError } from '../_shared/log-error.ts'

// Your Anthropic API key, set as a Supabase secret (never shipped to the
// browser):  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
// Which Claude model to use. Override with a secret if you want a different one:
//   supabase secrets set ANTHROPIC_MODEL=claude-...
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5-20250929'
// Max assistant requests per user per (UTC) day. Each Claude call counts —
// note a single chat message can trigger several when tools are used.
// Override with:  supabase secrets set AI_DAILY_LIMIT=200
const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '100')

// Thin proxy to the Anthropic Messages API. The frontend sends the system
// prompt, the running conversation, and the tool definitions; we just add the
// secret key and forward the response back. Tools are actually *executed* in
// the browser (using the logged-in user's session), so this function never
// touches the database — it only needs to guard the API key behind auth.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Require a valid logged-in user so random people can't spend your tokens.
    const userId = await getUserId(req)

    if (!ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...'
      )
    }

    // The AI assistant is a Pro feature — enforce server-side before spending
    // any tokens, so a free user can't call this directly to bypass the UI gate.
    if ((await getPlan(getServiceClient(), userId)) !== 'pro') {
      return paywallResponse(corsHeaders, 'The AI assistant')
    }

    // Enforce a per-user daily cap before spending anything on the API. If the
    // usage table/function isn't there yet (migration 0005 not run), fail OPEN
    // so the assistant keeps working — the cap simply isn't active until you
    // run the migration.
    try {
      const admin = getServiceClient()
      const { data, error } = await admin.rpc('increment_ai_usage', {
        p_user_id: userId,
        p_limit: DAILY_LIMIT,
      })
      if (error) {
        console.warn('ai_usage check skipped:', error.message)
      } else {
        const row = Array.isArray(data) ? data[0] : data
        if (row && row.allowed === false) {
          return new Response(
            JSON.stringify({
              error: `You've hit today's assistant limit of ${DAILY_LIMIT} requests. It resets at midnight UTC — check back tomorrow.`,
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
    } catch (e) {
      console.warn('ai_usage check errored, allowing request:', e.message)
    }

    const { system, messages, tools, max_tokens } = await req.json()

    // The chat UI is happy with 1024, but a vision extraction (e.g. a supplement
    // label with 20+ ingredients) can need more room to return complete JSON.
    // Honor a caller-supplied value, clamped so no single request can balloon.
    const maxTokens = Math.min(Math.max(Number(max_tokens) || 1024, 1), 4096)

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
      }),
    })

    const data = await resp.json()
    if (!resp.ok) {
      throw new Error(data?.error?.message ?? `Anthropic API error (${resp.status})`)
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = logError('chat', err)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
